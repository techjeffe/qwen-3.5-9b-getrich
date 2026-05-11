"""
PipelineService — orchestration layer for the analysis pipeline.

Encapsulates _run_analysis_pipeline from the original router.  This is the
main entry point that the refactored router calls.  All DI is explicit:
Session, PriceCacheService, and config are passed to the constructor.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from config.market_constants import SYMBOL_RELEVANCE_TERMS
from schemas.analysis import AnalysisRequest, AnalysisResponse, SentimentScore, TradingSignal
from services.analysis.cache_service import PriceCacheService
from services.analysis.sentiment_service import SentimentService
from services.analysis.signal_service import SignalService
from services.analysis.market_data_service import MarketDataService
from services.analysis.materiality_service import MaterialityService
from services.analysis.hysteresis_service import HysteresisService
from services.analysis.persistence_service import PersistenceService
from services.analysis.backtest_service import BacktestService
from services.risk_policy_runtime import build_crazy_ramp_context
from database.models import ScrapedArticle


# Module-level concurrency lock — prevents concurrent analysis pipeline runs.
# asyncio.Lock is per-event-loop; FastAPI runs a single event loop per worker,
# so this serializes all analysis requests across all endpoints.
_analysis_lock: asyncio.Lock = asyncio.Lock()


class PipelineService:
    """Orchestrates the full analysis pipeline: ingest → snapshot → sentiment → signal → persist."""

    def __init__(
        self,
        db: Session,
        price_cache: PriceCacheService,
        logic_config: dict[str, Any],
        continuous_entry_enabled: Optional[bool] = None,
        regime_adaptation_enabled: Optional[bool] = None,
        hold_decay_enabled: Optional[bool] = None,
    ) -> None:
        self._db = db
        self._price_cache = price_cache
        self._L = logic_config

        # Compose child services (dependency tree: unidirectional)
        self._sentiment = SentimentService(price_cache=price_cache, logic_config=logic_config)
        self._market = MarketDataService(price_cache=price_cache, logic_config=logic_config)
        self._signal = SignalService(
            logic_config=logic_config,
            continuous_entry_enabled=continuous_entry_enabled,
            regime_adaptation_enabled=regime_adaptation_enabled,
            hold_decay_enabled=hold_decay_enabled,
        )
        self._materiality = MaterialityService(logic_config=logic_config)
        self._hysteresis = HysteresisService(logic_config=logic_config)
        self._persistence = PersistenceService(logic_config=logic_config)
        self._backtest = BacktestService(logic_config=logic_config)

        # Pipeline state
        self.request_id: str = ""
        self.symbols: List[str] = []
        self.model_name: str = ""
        self.timestamp: str = ""
        self.analysis_id: str = ""

    # ── Public API ───────────────────────────────────────────────────

    async def run(
        self,
        request: AnalysisRequest,
        db: Session,
        config: Any,
        prompt_overrides: Optional[Dict[str, str]] = None,
        article_ids: Optional[List[int]] = None,
        trigger_source: str = "api",
    ) -> AnalysisResponse:
        """
        Run the full analysis pipeline synchronously (for non-streaming callers).
        This delegates to the async generator but collects all output.
        """
        response = None
        terminal_error: Optional[str] = None
        async for chunk in self.run_stream(
            request,
            db,
            config,
            prompt_overrides,
            article_ids=article_ids,
            trigger_source=trigger_source,
        ):
            # Parse the SSE result to extract the final response
            if isinstance(chunk, dict) and chunk.get("type") == "final_response":
                response = chunk.get("response")
            elif isinstance(chunk, dict) and chunk.get("type") == "error":
                terminal_error = str(chunk.get("detail") or chunk.get("message") or "Pipeline error")
                break
            elif isinstance(chunk, dict) and chunk.get("type") == "materiality_blocked":
                terminal_error = str(chunk.get("reason") or "Materiality gate blocked analysis")
                break
        if terminal_error:
            raise HTTPException(status_code=400, detail=terminal_error)
        if response is None:
            raise HTTPException(status_code=500, detail="Pipeline failed to produce a response")
        return response  # type: ignore[return-value]

    async def run_stream(
        self,
        request: AnalysisRequest,
        db: Session,
        config: Any,
        prompt_overrides: Optional[Dict[str, str]] = None,
        article_ids: Optional[List[int]] = None,
        trigger_source: str = "api",
    ) -> AsyncGenerator[Any, None]:
        """Run the full analysis pipeline as an async stream, yielding SSE events."""
        started_at = time.time()
        # ── Request setup ───────────────────────────────────────────────
        self.request_id = str(uuid.uuid4())
        self.symbols = list({s.upper() for s in (request.symbols or [])})
        if not self.symbols:
            self.symbols = self._get_default_symbols()
        self.model_name = self._resolve_active_model_name(config)
        self.timestamp = datetime.now(timezone.utc).isoformat()
        self._run_started = time.time()

        # ── Decision Log: run start ──────────────────────────────────────
        try:
            from database.engine import DecisionLogSessionLocal
            from services.decision_logger import logger as dl
            ddb = DecisionLogSessionLocal()
            try:
                dl.log_run_start(
                    ddb,
                    run_id=self.request_id,
                    trigger_source=trigger_source,
                    extraction_model=str(getattr(config, "extraction_model", "") or "").strip() or None,
                    reasoning_model=str(getattr(config, "reasoning_model", "") or "").strip() or None,
                    config_snapshot={
                        "entry_threshold": getattr(config, "entry_threshold", None),
                        "inference_backend": getattr(config, "inference_backend", "ollama"),
                        "risk_profile": getattr(config, "risk_profile", "moderate"),
                    },
                )
                ddb.commit()
            except Exception as dl_exc:
                ddb.rollback()
                print(f"[decision-log] run start error: {dl_exc}")
            finally:
                ddb.close()
        except Exception as dl_exc:
            print(f"[decision-log] run start error (non-fatal): {dl_exc}")

        # ── Lock (idempotency) ────────────────────────────────────────────
        analysis_id = await self._acquire_lock(self.request_id)
        self.analysis_id = analysis_id
        lock_acquired = True

        try:
            # ── Apply defaults ───────────────────────────────────────────────
            _ = self._apply_request_defaults(request, config)
            stage_metrics: Dict[str, Dict[str, Any]] = {}

            # ── Stage 1: Data ingestion ───────────────────────────────────────
            ingest_started_at = time.time()
            posts, ingestion_trace = await self._market.ingest_data(
                db,
                request,
                config,
                article_ids=article_ids,
                trigger_source=trigger_source,
            )
            stage_metrics["ingest"] = {
                "status": "completed",
                "model_name": "",
                "duration_ms": (time.time() - ingest_started_at) * 1000,
                "item_count": len(posts),
                "details": {
                    "selected_article_ids": list(ingestion_trace.get("selected_article_ids") or []),
                    "usable_article_ids": list(ingestion_trace.get("usable_article_ids") or []),
                },
            }
            if not posts:
                yield {"type": "error", "stage": "ingestion", "detail": "No usable articles found"}
                return

            # ── Market snapshot ───────────────────────────────────────────────
            snapshot_started_at = time.time()
            price_context, quotes_by_symbol, market_validation = await self._market.get_market_snapshot(self.symbols)

            # ── Technical context ──────────────────────────────────────────────
            price_context = self._market.inject_technical_context(price_context, self.symbols, db)
            stage_metrics["market_snapshot"] = {
                "status": "completed",
                "model_name": "",
                "duration_ms": (time.time() - snapshot_started_at) * 1000,
                "item_count": len(quotes_by_symbol),
                "details": {
                    "symbols_with_quotes": sorted(list(quotes_by_symbol.keys())),
                },
            }

            # ── Web research ──────────────────────────────────────────────────
            web_started_at = time.time()
            web_context_by_symbol: Dict[str, str] = {}
            web_items_by_symbol: Dict[str, List[Dict[str, Any]]] = {}
            try:
                web_context_by_symbol, web_items_by_symbol = await self._sentiment.get_symbol_web_research(
                    symbols=self.symbols,
                    enabled=bool(getattr(config, 'web_research_enabled', None)),
                    max_items_per_symbol=int(getattr(config, 'web_research_max_items', 10) or 10),
                    max_age_days=int(getattr(config, 'web_research_max_age_days', 5) or 5),
                    symbol_company_aliases=dict(getattr(config, 'symbol_company_aliases', {}) or {}),
                )
                stage_metrics["web_research"] = {
                    "status": "completed",
                    "model_name": "",
                    "duration_ms": (time.time() - web_started_at) * 1000,
                    "item_count": sum(len(items or []) for items in web_items_by_symbol.values()),
                    "details": {
                        "symbols": sorted(list(web_context_by_symbol.keys())),
                    },
                }
            except Exception as exc:
                stage_metrics["web_research"] = {
                    "status": "skipped",
                    "model_name": "",
                    "duration_ms": (time.time() - web_started_at) * 1000,
                    "item_count": 0,
                    "details": {"error": str(exc)},
                }

            # ── Hysteresis ────────────────────────────────────────────────────
            stability_mode = "normal"
            previous_state = self._hysteresis.latest_previous_analysis_state(db)
            previous_response = previous_state.get("response") if previous_state else None

            _prev_analysis = (previous_state or {}).get("analysis")
            _prev_ts = getattr(_prev_analysis, "timestamp", None) if _prev_analysis else None
            if _prev_ts is not None:
                if _prev_ts.tzinfo is None:
                    _prev_ts = _prev_ts.replace(tzinfo=timezone.utc)
                signal_age_hours = (datetime.now(timezone.utc) - _prev_ts).total_seconds() / 3600.0
            else:
                signal_age_hours = 0.0

            previous_signal = None
            if previous_response:
                prev_signal_payload = (
                    previous_response.get("blue_team_signal")
                    or previous_response.get("trading_signal")
                )
                if isinstance(prev_signal_payload, dict):
                    try:
                        previous_signal = TradingSignal.model_validate(prev_signal_payload)
                    except Exception:
                        previous_signal = None
            entry_threshold_override = None
            if self._hysteresis.is_closed_market_session(quotes_by_symbol):
                stability_mode = "closed_market_hysteresis"
                entry_threshold_override = self._L["entry_thresholds"].get("closed_market", 0.25)

            # ── Stage 2: Sentiment analysis ────────────────────────────────────
            extraction_model = getattr(config, "extraction_model", None)
            reasoning_model = getattr(config, "reasoning_model", None)
            stage2_timeout_seconds = float(
                getattr(config, "stage2_timeout_seconds", None) or self._L.get("stage2_timeout_seconds", 420)
            )

            # Apply the admin-configured Ollama parallelism budget for local models.
            # Cloud backends (OpenAI/vLLM) ignore the semaphore and run fully parallel.
            from services.sentiment.engine import SentimentEngine
            SentimentEngine.configure_parallelism(
                int(getattr(config, "ollama_parallel_slots", None) or 1)
            )

            try:
                sentiment_results, sentiment_trace = await asyncio.wait_for(
                    self._sentiment.analyze_sentiment(
                        posts=posts,
                        symbols=self.symbols,
                        price_context=price_context,
                        prompt_overrides=prompt_overrides,
                        model_name=self.model_name,
                        extraction_model=extraction_model,
                        reasoning_model=reasoning_model,
                        web_context_by_symbol=web_context_by_symbol,
                        symbol_proxy_terms_by_symbol=dict(getattr(config, "symbol_proxy_terms", {}) or {}),
                        openai_base_url=getattr(config, "openai_base_url", None),
                        openai_model=getattr(config, "openai_model", None),
                        ollama_url=getattr(config, "ollama_url", None),
                        vllm_url=getattr(config, "vllm_url", None),
                        cloud_provider=getattr(config, "cloud_provider", None),
                    ),
                    timeout=stage2_timeout_seconds,
                )
            except asyncio.TimeoutError:
                yield {
                    "type": "error",
                    "stage": "sentiment",
                    "detail": f"Sentiment stage timed out after {int(stage2_timeout_seconds)}s",
                }
                return
            stage_metrics.update({
                key: value
                for key, value in (sentiment_trace.get("stage_metrics") or {}).items()
                if isinstance(value, dict)
            })

            # ── Rolling sentiment blend ────────────────────────────────────────
            # Blend current sentiment scores with recent historical runs using
            # exponential decay to prevent single-run noise from flipping signals.
            from services.analysis.rolling_sentiment import load_recent_scores, blend_with_history

            historical_runs = load_recent_scores(
                db, self.symbols, max_age_hours=2.0,
            )
            blended_sentiment = blend_with_history(
                sentiment_results, historical_runs, half_life_hours=0.33,
            )

            # ── Trading signal ────────────────────────────────────────────────
            previous_posts_count = None
            if previous_state:
                prev_response = previous_state.get("response")
                if prev_response:
                    previous_posts_count = prev_response.get("posts_scraped")

            candidate_signal = self._signal.generate_trading_signal(
                sentiment_results=blended_sentiment,
                quotes_by_symbol=quotes_by_symbol,
                risk_profile=getattr(config, 'risk_profile', 'moderate'),
                previous_signal=previous_signal,
                stability_mode=stability_mode,
                entry_threshold_override=entry_threshold_override,
                price_context=price_context,
                signal_age_hours=signal_age_hours,
                crazy_ramp_context=await build_crazy_ramp_context(
                    symbols=self.symbols,
                    risk_profile=getattr(config, "risk_profile", "moderate"),
                    risk_policy=dict(getattr(config, "risk_policy", {}) or {}),
                    price_context=price_context,
                ),
                previous_posts_count=previous_posts_count,
                current_posts_count=len(posts),
            )

            # ── Materiality gate ──────────────────────────────────────────────
            per_symbol_counts = self._materiality._count_symbol_articles(
                posts, self.symbols, relevance_terms=SYMBOL_RELEVANCE_TERMS
            )
            # Apply crazy profile materiality threshold overrides
            _crazy_min_posts_delta = None
            _crazy_min_sent_delta = None
            _risk_profile = str(getattr(config, 'risk_profile', '') or '').strip().lower()
            if _risk_profile == "crazy":
                _crazy_cfg = self._L.get("crazy", {})
                _crazy_mg = _crazy_cfg.get("materiality_gate") or {}
                if isinstance(_crazy_mg, dict):
                    _crazy_min_posts_delta = _crazy_mg.get("min_posts_delta")
                    _crazy_min_sent_delta = _crazy_mg.get("min_sentiment_delta")
            is_material = self._materiality.material_change_gate(
                db=db,
                symbols=self.symbols,
                posts_count=len(posts),
                sentiment_results=sentiment_results,
                price_context=price_context,
                quotes_by_symbol=quotes_by_symbol,
                previous_state=previous_state,
                candidate_signal=candidate_signal,
                min_posts_delta=_crazy_min_posts_delta,
                min_sentiment_delta=_crazy_min_sent_delta,
                per_symbol_counts=per_symbol_counts,
            )
            materiality_status = "completed"
            materiality_details: Dict[str, Any] = {"is_material": bool(is_material)}
            if previous_state and not is_material and previous_signal:
                candidate_signal = previous_signal
                materiality_status = "skipped"
                materiality_details["kept_previous_signal"] = True
                print(f"[pipeline] Materiality gate BLOCKED — keeping previous signal (risk_profile={_risk_profile})")
            else:
                print(f"[pipeline] Materiality gate: is_material={is_material}, has_previous_state={previous_state is not None}, risk_profile={_risk_profile}")
            stage_metrics["materiality"] = {
                "status": materiality_status,
                "model_name": "",
                "duration_ms": 0.0,
                "item_count": len(per_symbol_counts),
                "details": materiality_details,
            }

            # ── Red-team review ──────────────────────────────────────────────
            red_team_review = None
            red_team_debug = None
            red_team_enabled = bool(getattr(config, 'red_team_enabled', True))
            red_team_status = "skipped"
            if red_team_enabled:
                red_started_at = time.time()
                try:
                    red_team_context = self._signal.build_red_team_context(
                        symbols=self.symbols,
                        posts=posts,
                        sentiment_results=sentiment_results,
                        trading_signal=candidate_signal,
                        price_context=price_context,
                        quotes_by_symbol=quotes_by_symbol,
                        market_validation=market_validation or {},
                    )
                    red_team_review, red_team_debug = self._signal.run_red_team_review(
                        model_name=self.model_name,
                        context={"raw_context": json.dumps(red_team_context, ensure_ascii=True, default=str, indent=2)},
                    )
                    if red_team_debug and red_team_review:
                        red_team_debug.signal_changes = self._signal.build_red_team_signal_changes(
                            candidate_signal,
                            candidate_signal,
                            red_team_review,
                        )
                    red_team_status = "completed"
                    stage_metrics["red_team"] = {
                        "status": "completed",
                        "model_name": self.model_name,
                        "duration_ms": (time.time() - red_started_at) * 1000,
                        "item_count": len(self.symbols),
                        "details": {},
                    }
                except Exception as exc:
                    red_team_status = "skipped"
                    stage_metrics["red_team"] = {
                        "status": "skipped",
                        "model_name": self.model_name,
                        "duration_ms": (time.time() - red_started_at) * 1000,
                        "item_count": len(self.symbols),
                        "details": {"error": str(exc)},
                    }
            else:
                stage_metrics["red_team"] = {
                    "status": "skipped",
                    "model_name": "",
                    "duration_ms": 0.0,
                    "item_count": len(self.symbols),
                    "details": {"reason": "disabled"},
                }

            # ── Backtest ──────────────────────────────────────────────────────
            backtest_status = "completed"
            backtest_started_at = time.time()
            try:
                backtest_results = await self._backtest.run_backtest(
                    symbols=self.symbols,
                    sentiment_results=sentiment_results,
                    risk_profile=getattr(config, "risk_profile", "moderate"),
                )
            except Exception as exc:
                backtest_status = "skipped"
                backtest_results = {
                    "total_return": 0.0, "annualized_return": 0.0, "sharpe_ratio": 0.0,
                    "max_drawdown": 0.0, "win_rate": 0.0, "total_trades": 0,
                    "lookback_days": 14, "walk_forward_steps": 0,
                }
                stage_metrics["backtest"] = {
                    "status": "skipped",
                    "model_name": "",
                    "duration_ms": (time.time() - backtest_started_at) * 1000,
                    "item_count": len(self.symbols),
                    "details": {"error": str(exc)},
                }
            else:
                stage_metrics["backtest"] = {
                    "status": "completed",
                    "model_name": "",
                    "duration_ms": (time.time() - backtest_started_at) * 1000,
                    "item_count": len(self.symbols),
                    "details": {},
                }

            # ── Consensus signal ─────────────────────────────────────────────
            consensus_signal = self._signal.build_consensus_trading_signal(
                blue_team_signal=candidate_signal,
                red_team_review=red_team_review,
                quotes_by_symbol=quotes_by_symbol,
                risk_profile=getattr(config, 'risk_profile', 'moderate'),
            )
            if red_team_debug and red_team_review:
                red_team_debug.signal_changes = self._signal.build_red_team_signal_changes(
                    candidate_signal,
                    consensus_signal,
                    red_team_review,
                )

            model_inputs = self._sentiment.build_model_input_debug(
                posts=posts,
                price_context=price_context,
                market_validation=market_validation or {},
                symbols=self.symbols,
                prompt_overrides=prompt_overrides,
                web_context_by_symbol=web_context_by_symbol,
                web_items_by_symbol=web_items_by_symbol,
            )

            processing_time_ms = (time.time() - started_at) * 1000
            secret_trace = {
                "request_id": self.request_id,
                "request": getattr(request, "model_dump", lambda: {})(),
                "models": {
                    "active_model": self.model_name,
                    "extraction_model": extraction_model or "",
                    "reasoning_model": reasoning_model or "",
                    "risk_profile": getattr(config, "risk_profile", "moderate"),
                },
                "pipeline_events": [
                    "ingest:completed",
                    "market_snapshot:completed",
                    "web_research:completed" if stage_metrics.get("web_research", {}).get("status") == "completed" else "web_research:skipped",
                    "sentiment:completed",
                    "signal:completed",
                    f"materiality:{materiality_status}",
                    f"red_team:{red_team_status}",
                    f"backtest:{backtest_status}",
                ],
                "ingestion": ingestion_trace or {},
                "web_research": {
                    "context_by_symbol": web_context_by_symbol,
                    "items_by_symbol": web_items_by_symbol,
                },
                "sentiment": {
                    "stage_trace": sentiment_trace,
                    "symbol_results": sentiment_results,
                },
                "blue_team_signal": candidate_signal.model_dump(mode="json") if candidate_signal else {},
                "trading_signal": consensus_signal.model_dump(mode="json") if consensus_signal else {},
                "red_team_review": red_team_review.model_dump(mode="json") if red_team_review else {},
                "red_team_debug": red_team_debug.model_dump(mode="json") if red_team_debug else {},
            }

            # ── Build response ──────────────────────────────────────────────
            response = AnalysisResponse(
                request_id=self.request_id,
                status="SUCCESS",
                timestamp=self.timestamp,
                symbols_analyzed=list(sentiment_results.keys()),
                posts_scraped=len(posts),
                sentiment_scores={
                    symbol: SentimentScore(
                        market_bluster=float(result.get("bluster_score", 0.0) or 0.0),
                        policy_change=float(result.get("policy_score", 0.0) or 0.0),
                        confidence=float(result.get("confidence", 0.0) or 0.0),
                        reasoning=str(result.get("reasoning", "") or ""),
                    )
                    for symbol, result in sentiment_results.items()
                },
                aggregated_sentiment=None,
                trading_signal=consensus_signal,
                blue_team_signal=candidate_signal,
                market_validation=market_validation or {},
                model_inputs=model_inputs,
                ingestion_trace=ingestion_trace,
                red_team_review=red_team_review,
                red_team_debug=red_team_debug,
                stage_metrics=stage_metrics,
                backtest_results=backtest_results,
                processing_time_ms=processing_time_ms,
                request_payload=getattr(request, 'model_dump', lambda: {})(),
            )

            # ── Persist ──────────────────────────────────────────────────────
            self._persistence.save_analysis_result(
                db=db,
                request_id=self.request_id,
                response=response,
                quotes_by_symbol=quotes_by_symbol,
                posts=posts,
                model_name=self.model_name,
                prompt_overrides=prompt_overrides,
                extraction_model=extraction_model or "",
                reasoning_model=reasoning_model or "",
                risk_profile=getattr(config, 'risk_profile', 'moderate'),
                secret_trace=secret_trace,
                sentiment_results=sentiment_results,
                per_symbol_counts=per_symbol_counts,
                price_context=price_context,
            )
            self._mark_scraped_articles_processed(db, ingestion_trace.get("selected_article_ids") or [])

            # ── Decision Logging ────────────────────────────────────────────
            try:
                from database.engine import DecisionLogSessionLocal
                from services.decision_logger import logger as dl

                ddb = DecisionLogSessionLocal()
                try:
                    # Run-level logging
                    dl.log_run_complete(
                        ddb,
                        run_id=self.request_id,
                        total_articles_considered=len(posts) if posts else None,
                        total_articles_used=len(sentiment_results) if sentiment_results else None,
                        duration_ms=int((time.time() - self._run_started) * 1000) if hasattr(self, '_run_started') else None,
                    )

                    # Per-symbol logging
                    for sym, result in (sentiment_results or {}).items():
                        raw_scores = {
                            "bluster": result.get("bluster_score"),
                            "policy": result.get("policy_score"),
                            "confidence": result.get("confidence"),
                            "directional": result.get("directional_score"),
                        }
                        signal_dict = consensus_signal.model_dump(mode="json") if consensus_signal else {}
                        dl.log_symbol_scores(
                            ddb,
                            run_id=self.request_id,
                            symbol=sym,
                            raw_scores=raw_scores,
                            final_signal={
                                "type": signal_dict.get("signal_type"),
                                "conviction": signal_dict.get("conviction_level"),
                                "trading_type": signal_dict.get("trading_type"),
                                "holding_window_hours": signal_dict.get("holding_period_hours"),
                                "urgency": signal_dict.get("urgency"),
                                "stop_loss_pct": signal_dict.get("stop_loss_pct"),
                                "take_profit_pct": signal_dict.get("take_profit_pct"),
                                "data_gap_hold": signal_dict.get("data_gap_hold"),
                            },
                            entry_threshold_used=stage_metrics.get("entry_threshold"),
                            materiality_info={
                                "checked": stage_metrics.get("materiality", {}).get("gate_checked", False),
                                "blocked": stage_metrics.get("materiality", {}).get("gate_blocked", False),
                                "reason": stage_metrics.get("materiality", {}).get("gate_reason"),
                                "rolling_baseline": stage_metrics.get("materiality", {}).get("rolling_baseline"),
                            },
                        )
                    ddb.commit()
                except Exception as dl_exc:
                    ddb.rollback()
                    print(f"[decision-log] symbol logging error: {dl_exc}")
                finally:
                    ddb.close()
            except Exception as dl_exc:
                print(f"[decision-log] pipeline logging error (non-fatal): {dl_exc}")

            yield {"type": "final_response", "response": response}
        finally:
            # Always release the concurrency lock when the pipeline finishes
            # (success, error, or early return via generator close).
            if lock_acquired:
                try:
                    _analysis_lock.release()
                except RuntimeError:
                    pass  # Lock may have been released already

    # ── Helpers (private) ───────────────────────────────────────────────

    def _get_default_symbols(self) -> List[str]:
        """Return the default symbol list when no symbols are explicitly provided."""
        return ["USO", "IBIT", "QQQ", "SPY"]

    def _resolve_active_model_name(self, config: Any) -> str:
        # Prefer the current two-stage config fields; keep legacy support.
        reasoning_model = str(getattr(config, "reasoning_model", "") or "").strip()
        extraction_model = str(getattr(config, "extraction_model", "") or "").strip()
        legacy_model = str(getattr(config, "analysis_model", "") or "").strip()
        env_model = str(os.getenv("OLLAMA_MODEL", "") or "").strip()
        return reasoning_model or extraction_model or legacy_model or env_model or "unknown"

    def _apply_request_defaults(self, request: AnalysisRequest, config: Any) -> AnalysisRequest:
        return request

    def _coerce_to_json_compatible(self, result: Dict[str, Any]) -> Dict[str, Any]:
        return {
            key: str(value) if isinstance(value, (set, frozenset)) else value
            for key, value in result.items()
        }

    async def _acquire_lock(self, request_id: str) -> str:
        """Acquire an analysis lock to prevent concurrent runs for the same request."""
        # Use the module-level asyncio.Lock to serialize all analysis pipeline runs.
        # This prevents the frontend's two concurrent auto-run components (page.tsx
        # and AnalysisContext.tsx) from both triggering analysis simultaneously.
        acquired = _analysis_lock.locked()
        if acquired:
            raise RuntimeError(
                f"Analysis already in progress (lock held by another request). "
                f"Request {request_id} rejected to prevent concurrent pipeline runs."
            )
        await _analysis_lock.acquire()
        analysis_id = str(uuid.uuid4())
        return analysis_id

    def _mark_scraped_articles_processed(self, db: Session, article_ids: List[int]) -> None:
        """Mark selected queued articles as processed."""
        if not article_ids:
            return
        (
            db.query(ScrapedArticle)
            .filter(ScrapedArticle.id.in_(article_ids))
            .update({ScrapedArticle.processed: True}, synchronize_session=False)
        )
        db.commit()