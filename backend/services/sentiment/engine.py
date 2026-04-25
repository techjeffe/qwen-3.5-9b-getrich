"""
Sentiment Engine using Ollama Llama-3-70b
Analyzes geopolitical text for market bluster vs policy changes
"""

import os
import re
import json
import time
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from pydantic import BaseModel, Field
import requests
import asyncio

from .prompts import expand_proxy_terms_for_matching, normalize_text_for_matching
from config.logic_loader import LOGIC as _L


@dataclass
class SentimentAnalysisResult:
    """Result of a single sentiment analysis."""
    text_source: str
    timestamp: datetime
    is_bluster: bool
    bluster_score: float
    bluster_indicators: List[str]
    is_policy_change: bool
    policy_score: float
    policy_indicators: List[str]
    impact_severity: str
    confidence: float
    reasoning: str


class SentimentAnalysisRequest(BaseModel):
    """Request model for sentiment analysis."""
    text: str = Field(..., min_length=10, max_length=5000)
    text_source: str = Field(default="")
    include_context: bool = Field(default=False)
    context_data: Optional[Dict[str, Any]] = Field(default=None)


class SentimentAnalysisResponse(BaseModel):
    """Response model for sentiment analysis."""
    request_id: str
    timestamp: datetime
    is_bluster: bool
    bluster_score: float
    bluster_indicators: List[str]
    is_policy_change: bool
    policy_score: float
    policy_indicators: List[str]
    impact_severity: str
    confidence: float
    reasoning: str
    directional_score: float = 0.0
    signal_type: str = "HOLD"
    urgency: str = "LOW"
    entry_symbol: str = ""
    analyst_writeup: str = ""
    supporting_points: List[str] = Field(default_factory=list)
    headline_citations: List[str] = Field(default_factory=list)
    symbol_impacts: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    prompt_used: str = ""
    raw_model_response: str = ""
    parsed_payload: Dict[str, Any] = Field(default_factory=dict)


# Module-level keyword cache keyed by symbol (uppercase).
# Persists for the server session so LLM is only called once per symbol.
_keyword_cache: Dict[str, List[str]] = {}
_keyword_trace_cache: Dict[str, Dict[str, Any]] = {}


class SentimentEngine:
    """
    Sentiment analysis engine using Ollama Llama-3-70b.
    
    Features:
    - Market bluster detection
    - Policy change identification
    - Trading signal generation
    - Caching for repeated analyses
    - Fallback handling
    """
    
    # Configuration — override with OLLAMA_MODEL and OLLAMA_URL env vars
    MODEL_NAME = os.getenv("OLLAMA_MODEL", "").strip()
    TEMPERATURE = 0.10
    MAX_TOKENS = 4096
    API_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
    
    # Caching
    _cache: Dict[str, SentimentAnalysisResponse] = {}
    _cache_ttl: int = 300  # 5 minutes
    
    def __init__(self, api_url: Optional[str] = None, model_name: Optional[str] = None):
        """
        Initialize sentiment engine.
        
        Args:
            api_url: Ollama API URL (default: localhost:11434)
        """
        self.api_url = api_url or self.API_URL
        self.model_name = (model_name or self.MODEL_NAME or "").strip()
        self.session = requests.Session()
        self._cache = {}
    
    def clear_cache(self):
        """Clear all cached analysis results."""
        self._cache = {}
    
    async def analyze(
        self,
        text: str,
        text_source: str = "",
        include_context: bool = False,
        context_data: Optional[Dict[str, Any]] = None,
        specialist_symbol: Optional[str] = None,
        specialist_focus: str = "",
        model_override: Optional[str] = None,
        proxy_context: str = "",
        web_research_context: str = "",
    ) -> SentimentAnalysisResponse:
        """
        Analyze text for market bluster and policy changes.
        
        Args:
            text: Text to analyze (from social media or news)
            text_source: Source identifier for caching
            include_context: Whether to include market context
            context_data: Optional market data for context-aware analysis
            
        Returns:
            SentimentAnalysisResponse with bluster and policy scores
        """
        # Check cache first
        cache_key = f"{text_source}:{specialist_symbol or 'generic'}:{text[:100]}:{web_research_context[:120]}"
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if (datetime.utcnow() - cached.timestamp).total_seconds() < self._cache_ttl:
                return cached
        
        # Let exceptions propagate — callers must handle Ollama being unavailable
        if include_context and context_data:
            response = await self._analyze_with_context(
                text,
                text_source,
                context_data,
                specialist_symbol=specialist_symbol,
                specialist_focus=specialist_focus,
                model_override=model_override,
                proxy_context=proxy_context,
                web_research_context=web_research_context,
            )
        else:
            response = await self._analyze_text(text, text_source, model_override=model_override)

        self._cache[cache_key] = response
        return response
    
    async def _analyze_text(
        self,
        text: str,
        text_source: str,
        model_override: Optional[str] = None,
    ) -> SentimentAnalysisResponse:
        """Analyze text using combined prompt."""
        from .prompts import format_combined_prompt

        prompt = format_combined_prompt(text)
        response_data = await self._call_ollama(prompt, model_override=model_override, force_json=True)
        parsed = self._parse_response(response_data, text_source)
        parsed.prompt_used = prompt
        return parsed

    async def _analyze_with_context(
        self,
        text: str,
        text_source: str,
        context_data: Dict[str, Any],
        specialist_symbol: Optional[str] = None,
        specialist_focus: str = "",
        model_override: Optional[str] = None,
        proxy_context: str = "",
        web_research_context: str = "",
    ) -> SentimentAnalysisResponse:
        """Analyze text with market context, optionally injecting Stage 1 proxy context."""
        from .prompts import (
            format_context_aware_prompt,
            format_symbol_specialist_context_prompt,
        )

        date = datetime.utcnow().strftime("%Y-%m-%d")
        active_symbol = specialist_symbol or str(context_data.get("active_symbol", "") or "")
        active_symbol_price = context_data.get("active_symbol_price", 0.0)
        validation_context = context_data.get("validation_context", "")
        source_count = int(context_data.get("source_count", 0))

        if specialist_symbol:
            # Lean single-symbol prompt — no cross-symbol rules or basket instructions
            prompt = format_symbol_specialist_context_prompt(
                symbol=specialist_symbol,
                specialist_focus=specialist_focus,
                text=text,
                date=date,
                active_symbol_price=active_symbol_price,
                validation_context=validation_context,
                web_research_context=web_research_context,
                proxy_context=proxy_context,
                source_count=source_count,
            )
        else:
            prompt = format_context_aware_prompt(
                text=text,
                date=date,
                active_symbol=active_symbol,
                active_symbol_price=active_symbol_price,
                uso_price=context_data.get("uso_price", 0.0),
                bito_price=context_data.get("bito_price", 0.0),
                qqq_price=context_data.get("qqq_price", 0.0),
                spy_price=context_data.get("spy_price", 0.0),
                recent_sentiment=context_data.get("recent_sentiment", ""),
                validation_context=validation_context,
                web_research_context=web_research_context,
            )

        response_data = await self._call_ollama(prompt, model_override=model_override, force_json=True)
        parsed = self._parse_response(response_data, text_source)
        parsed.prompt_used = prompt
        return parsed

    @staticmethod
    def compute_symbol_scores(extraction: Dict[str, Any], symbol: str) -> Dict[str, Any]:
        """
        Derive calibrated scores from LLM-extracted facts.
        All numerical outputs come from this function — the LLM never outputs raw floats.
        """
        event_type = str(extraction.get("event_type") or "noise").lower()
        confirmed = bool(extraction.get("confirmed", False))
        bluster_phrases = extraction.get("bluster_phrases") or []
        substance_phrases = extraction.get("substance_phrases") or []
        source_count = max(1, min(10, int(extraction.get("source_count") or 2)))

        sym_rel = (extraction.get("symbol_relevance") or {}).get(symbol, {})
        relevant = bool(sym_rel.get("relevant", False))
        direction = str(sym_rel.get("direction") or "neutral").lower()
        exposure_type = str(extraction.get("exposure_type") or "").upper()
        if exposure_type not in {"DIRECT", "INDIRECT", "BROAD", "UNRELATED"}:
            exposure_type = "DIRECT" if relevant else "UNRELATED"
        transmission_path = str(extraction.get("transmission_path") or "").strip()
        if not transmission_path:
            transmission_path = str(sym_rel.get("mechanism") or "").strip() or "No credible transmission path."

        _ss = _L["sentiment_scoring"]

        # ── Bluster score: −1 (pure rhetoric) → +1 (pure substance) ──────────
        n_sub = len(substance_phrases)
        n_blu = len(bluster_phrases)
        bluster_weight = float(_ss.get("bluster_phrase_weight", 1.25))
        substance_weight = float(_ss.get("substance_phrase_weight", 1.0))
        mixed_floor = float(_ss.get("mixed_signal_bluster_floor", -0.15))
        weighted_sub = n_sub * substance_weight
        weighted_blu = n_blu * bluster_weight
        total = weighted_sub + weighted_blu
        raw_bluster = (weighted_sub - weighted_blu) / total if total else 0.0
        # If the text contains both rhetoric and substance, keep a modest negative bluster
        # score instead of collapsing to perfect neutrality.
        if n_blu > 0 and n_sub > 0:
            raw_bluster = min(raw_bluster, mixed_floor)
        if not confirmed:
            raw_bluster = max(-1.0, raw_bluster - _ss["unconfirmed_bluster_penalty"])
        bluster_score = round(max(-1.0, min(1.0, raw_bluster)), 3)

        # ── Policy score: 0 (irrelevant noise) → 1 (major confirmed policy) ──
        event_base: Dict[str, float] = dict(_ss["event_base_scores"])
        base_policy = event_base.get(event_type, event_base["default"])
        policy_score = base_policy * (1.0 if confirmed else _ss["unconfirmed_policy_multiplier"])
        if not relevant:
            policy_score *= _ss["irrelevance_policy_multiplier"]
        policy_cap = float((_ss.get("exposure_policy_caps") or {}).get(exposure_type, 1.0))
        policy_score = min(policy_score, policy_cap)
        policy_score = round(max(0.0, min(1.0, policy_score)), 3)

        # ── Confidence: grows with source diversity and drops if irrelevant ───
        base_conf = _ss["confidence_base"] + (source_count / 10.0) * _ss["confidence_source_weight"]
        if not relevant:
            base_conf -= _ss["confidence_irrelevance_penalty"]
        if not confirmed:
            base_conf -= _ss["confidence_unconfirmed_penalty"]
        confidence_cap = float((_ss.get("exposure_confidence_caps") or {}).get(exposure_type, _ss["confidence_max"]))
        base_conf = min(base_conf, confidence_cap)
        confidence = round(max(_ss["confidence_min"], min(_ss["confidence_max"], base_conf)), 3)

        # ── Signal type: rule-based from scores and direction ─────────────────
        _min_mag = _ss["directional_score_min_magnitude"]
        # bluster_short_threshold is intentionally more negative than the old -0.35
        # to require stronger bluster before auto-triggering SHORT without policy backing
        if bluster_score < _ss["bluster_short_threshold"] and policy_score < _ss["policy_signal_threshold"]:
            signal_type = "SHORT"
        elif policy_score >= _ss["policy_signal_threshold"] and relevant:
            if direction == "bullish":
                signal_type = "LONG"
            elif direction == "bearish":
                signal_type = "SHORT"
            else:
                signal_type = "HOLD"
        else:
            signal_type = "HOLD"

        # ── Directional score: signed magnitude for downstream signal gen ─────
        if signal_type == "LONG":
            directional_score = round(min(1.0, max(_min_mag, policy_score)), 3)
        elif signal_type == "SHORT":
            # Weighted blend: policy evidence (60%) + bluster magnitude (40%)
            # Prevents pure rhetoric from producing a full-strength SHORT score
            _short_mag = abs(bluster_score) * 0.4 + policy_score * 0.6
            directional_score = round(max(-1.0, min(-_min_mag, -_short_mag)), 3)
        else:
            directional_score = 0.0

        # ── Impact severity ───────────────────────────────────────────────────
        if policy_score >= _ss["impact_severity_high"]:
            impact_severity = "high"
        elif policy_score >= _ss["impact_severity_medium"]:
            impact_severity = "medium"
        else:
            impact_severity = "low"

        return {
            "bluster_score":    bluster_score,
            "policy_score":     policy_score,
            "confidence":       confidence,
            "signal_type":      signal_type,
            "directional_score": directional_score,
            "impact_severity":  impact_severity,
            "is_bluster":       bluster_score < _ss["bluster_detection_threshold"],
            "is_policy_change": policy_score >= _ss["policy_change_threshold"] and relevant,
            "exposure_type":    exposure_type,
            "transmission_path": transmission_path,
        }

    @staticmethod
    def compute_red_team_confidence(
        adjusted_signal: str,
        blue_signal: str,
        evidence: list,
        key_risks: list,
        source_bias_applied: bool,
    ) -> float:
        """
        Derive confidence from red-team qualitative output.
        LLM provides the categorical signal and lists of evidence/risks.
        Python converts those counts into a calibrated confidence float.
        """
        _rt = _L["red_team"]
        base = _rt["confidence_base"]
        # Agreement with blue team adds confidence; disagreement reduces it
        if adjusted_signal.upper() == blue_signal.upper():
            base += _rt["agreement_bonus"]
        else:
            base -= _rt["disagreement_penalty"]
        # More evidence → more confident; more risks → less confident
        base += min(_rt["evidence_bonus_max"], len(evidence) * _rt["evidence_bonus_per_item"])
        base -= min(_rt["risk_penalty_max"], len(key_risks) * _rt["risk_penalty_per_item"])
        if source_bias_applied:
            base -= _rt["source_bias_penalty"]
        return round(max(_rt["confidence_min"], min(_rt["confidence_max"], base)), 3)

    @staticmethod
    def compute_red_team_stop_loss(adjusted_urgency: str) -> float:
        """Rule-based stop loss from urgency — removes the LLM float guess."""
        return _L["red_team"]["stop_loss_by_urgency"].get(
            str(adjusted_urgency).upper(), 2.5
        )

    @staticmethod
    def red_team_override_is_material(
        adjusted_signal: str,
        blue_signal: str,
        evidence: list,
        key_risks: list,
        source_bias_applied: bool,
    ) -> bool:
        """Require stronger evidence before red team is allowed to overturn blue team."""
        normalized_adjusted = str(adjusted_signal or "HOLD").upper().strip()
        normalized_blue = str(blue_signal or "HOLD").upper().strip()
        if normalized_adjusted == normalized_blue:
            return True

        confidence = SentimentEngine.compute_red_team_confidence(
            adjusted_signal=normalized_adjusted,
            blue_signal=normalized_blue,
            evidence=evidence,
            key_risks=key_risks,
            source_bias_applied=source_bias_applied,
        )

        evidence_count = len(evidence or [])
        risk_count = len(key_risks or [])
        _rt = _L["red_team"]
        if normalized_adjusted == "HOLD":
            return (
                confidence >= _rt["hold_override_min_confidence"]
                and (evidence_count >= _rt["hold_override_min_evidence_or_risks"]
                     or risk_count >= _rt["hold_override_min_evidence_or_risks"])
            )
        return (
            confidence >= _rt["flip_override_min_confidence"]
            and evidence_count >= _rt["flip_override_min_evidence"]
            and evidence_count >= risk_count + 1
            and not source_bias_applied
        )

    @staticmethod
    def _strip_thinking(text: str) -> str:
        """Remove <think>...</think> blocks emitted by Qwen3 models."""
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    @staticmethod
    def _sanitize_json(json_str: str) -> str:
        """
        Clean LLM-generated JSON:
        1. Strip // line comments (char-by-char to skip comments inside strings)
        2. Remove trailing commas before } or ]
        3. Insert missing commas between adjacent JSON values (most common LLM mistake)
        4. Normalize CRLF and remove stray control characters
        """
        # Normalize line endings and strip BOM
        json_str = json_str.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")

        # ── Pass 1: strip // comments outside strings ─────────────────────────
        result: list[str] = []
        in_string = False
        escaped = False
        i = 0
        while i < len(json_str):
            ch = json_str[i]
            if escaped:
                result.append(ch)
                escaped = False
                i += 1
                continue
            if ch == "\\" and in_string:
                result.append(ch)
                escaped = True
                i += 1
                continue
            if ch == '"':
                in_string = not in_string
                result.append(ch)
                i += 1
                continue
            if not in_string and ch == "/" and i + 1 < len(json_str) and json_str[i + 1] == "/":
                while i < len(json_str) and json_str[i] != "\n":
                    i += 1
                continue
            # Drop bare control characters (tab and newline are fine)
            if not in_string and ord(ch) < 0x20 and ch not in ("\n", "\t"):
                i += 1
                continue
            result.append(ch)
            i += 1
        cleaned = "".join(result)

        # ── Pass 2: trailing comma removal ────────────────────────────────────
        cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)

        # ── Pass 3: insert missing commas between adjacent values ─────────────
        # Matches: end of a value (string-close, number, bool, null, ], })
        # followed by whitespace (with or without newline) then start of a new
        # key or value ("). This is the most common cause of
        # "Expecting ',' delimiter" in LLM-generated JSON.
        _VALUE_END = r'(?:"(?:[^"\\]|\\.)*"|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[\]\}])'
        cleaned = re.sub(
            r'(' + _VALUE_END + r')(\s+)(")',
            lambda m: m.group(1) + "," + m.group(2) + m.group(3),
            cleaned,
        )

        return cleaned

    @staticmethod
    def _parse_json_with_repair(json_str: str) -> Dict[str, Any]:
        """
        Parse JSON, retrying up to 25 times by inserting a comma exactly where
        Python's json decoder reports the missing delimiter.  This is more
        reliable than regex guessing because the error position is exact.
        """
        s = json_str
        for _ in range(25):
            try:
                return json.loads(s)
            except json.JSONDecodeError as e:
                if "Expecting ',' delimiter" in str(e) and 0 < e.pos < len(s):
                    s = s[: e.pos] + "," + s[e.pos :]
                else:
                    raise
        return json.loads(s)

    @staticmethod
    def _extract_json_value(text: str) -> Any:
        """
        Robustly extract the first decodable JSON value from model output.

        Tries, in order:
        - full response as-is
        - fenced ```json ... ``` blocks
        - first decodable object/array found via raw_decode scanning

        This is safer than slicing from the first '{' to the last '}' because it
        tolerates trailing prose, stray brackets, and top-level arrays.
        """
        decoder = json.JSONDecoder()
        raw = str(text or "").strip()
        if not raw:
            raise ValueError("Empty model response")

        candidates: list[str] = [raw]
        fenced_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", raw, flags=re.IGNORECASE)
        candidates.extend(block.strip() for block in fenced_blocks if block.strip())

        for candidate in candidates:
            sanitized = SentimentEngine._sanitize_json(candidate)
            try:
                return SentimentEngine._parse_json_with_repair(sanitized)
            except Exception:
                pass

            for match in re.finditer(r"[\{\[]", sanitized):
                try:
                    value, _ = decoder.raw_decode(sanitized[match.start():])
                    return value
                except json.JSONDecodeError:
                    continue

        raise ValueError("No decodable JSON payload found in model response")

    async def _call_ollama(
        self,
        prompt: str,
        model_override: Optional[str] = None,
        force_json: bool = False,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        return await asyncio.to_thread(self._call_ollama_sync, prompt, model_override, force_json, max_tokens)

    async def _generate_symbol_keywords(
        self,
        symbol: str,
        model: str,
    ) -> List[str]:
        """Return proxy keywords for a symbol.

        Built-in symbols (USO/BITO/QQQ/SPY) return static terms instantly.
        Custom symbols call the LLM once and cache the result for the session.
        """
        from .prompts import TICKER_PROXY_MAP, format_keyword_generation_prompt

        sym = symbol.upper()

        if sym in TICKER_PROXY_MAP:
            terms = [t.lower() for t in TICKER_PROXY_MAP[sym]]
            static_prompt = (
                f"Stage 1 used the built-in static proxy map for {sym}. "
                "No LLM keyword-generation prompt was sent for this symbol.\n\n"
                f"Static proxy terms:\n- " + "\n- ".join(TICKER_PROXY_MAP[sym])
            )
            _keyword_trace_cache[sym] = {
                "symbol": sym,
                "mode": "static_map",
                "model": "",
                "cache_hit": False,
                "prompt": static_prompt,
                "raw_response": "No model response. Stage 1 used built-in proxy terms.",
                "terms": terms,
                "error": None,
            }
            return terms

        if sym in _keyword_cache:
            cached_trace = dict(_keyword_trace_cache.get(sym, {}))
            cached_trace["cache_hit"] = True
            _keyword_trace_cache[sym] = cached_trace
            return _keyword_cache[sym]

        print(f"Stage 1: generating keywords for custom symbol {sym} via {model}...")
        try:
            prompt = format_keyword_generation_prompt(sym)
            raw = await self._call_ollama(
                prompt, model_override=model, force_json=True, max_tokens=512
            )
            raw_text = self._strip_thinking(raw.get("response", ""))
            data = self._extract_json_value(raw_text)
            if not isinstance(data, dict):
                raise ValueError("Keyword generation returned non-object JSON")
            raw_terms = (
                data.get("terms") or data.get("keywords")
                or data.get("proxy_terms") or []
            )
            terms = [str(t).lower().strip() for t in raw_terms if t][:30]

            if terms:
                _keyword_cache[sym] = terms
                _keyword_trace_cache[sym] = {
                    "symbol": sym,
                    "mode": "llm",
                    "model": model,
                    "cache_hit": False,
                    "prompt": prompt,
                    "raw_response": raw.get("response", ""),
                    "terms": terms,
                    "error": None,
                }
                print(f"Stage 1: cached {len(terms)} keywords for {sym}: {', '.join(terms[:8])}{'...' if len(terms) > 8 else ''}")
                return terms

            raise ValueError("LLM returned empty terms list")

        except Exception as exc:
            print(f"Stage 1: keyword generation failed for {sym} ({exc}) — using ticker name as fallback")

        fallback = [sym.lower()]
        _keyword_cache[sym] = fallback
        _keyword_trace_cache[sym] = {
            "symbol": sym,
            "mode": "fallback",
            "model": model,
            "cache_hit": False,
            "prompt": locals().get("prompt", ""),
            "raw_response": locals().get("raw", {}).get("response", "") if isinstance(locals().get("raw"), dict) else "",
            "terms": fallback,
            "error": str(locals().get("exc", "fallback to ticker name")),
        }
        return fallback

    async def extract_relevant_articles(
        self,
        posts: List[Any],
        symbols: List[str],
        extraction_model: str,
    ) -> Dict[str, Any]:
        """
        Stage 1 — keyword-based filtering using per-symbol proxy terms.

        For built-in symbols (USO/BITO/QQQ/SPY): uses static TICKER_PROXY_MAP.
        For custom symbols (e.g. NVDA, NOW): calls the LLM once to generate
        proxy keywords, caches them for the session, then uses pure keyword matching.
        No per-article LLM calls — fast regardless of article count.
        """
        # Fetch keywords for all symbols (parallel; built-ins return immediately)
        tasks = [self._generate_symbol_keywords(sym, extraction_model) for sym in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_terms: set = set()
        proxy_terms_by_symbol: Dict[str, List[str]] = {}
        for sym, kws in zip(symbols, results):
            if isinstance(kws, Exception):
                kws = [sym.lower()]
            proxy_terms_by_symbol[sym] = list(kws)
            all_terms.update(kws)

        # Normalized keyword matching — milliseconds, no model needed
        expanded_terms = expand_proxy_terms_for_matching(list(all_terms))
        keyword_relevant: List[Any] = []
        for post in posts:
            blob = normalize_text_for_matching(
                f"{getattr(post, 'title', '') or ''} "
                f"{getattr(post, 'content', '') or ''}"
            )
            if any(term in blob for term in expanded_terms):
                keyword_relevant.append(post)

        filtered = keyword_relevant or posts  # never return empty
        print(
            f"Stage 1 keyword filter: {len(keyword_relevant)}/{len(posts)} articles matched"
            f" | using {'keyword matches' if keyword_relevant else 'all articles (no keyword hits)'}"
        )

        # Derive per-symbol exposure quality: what fraction of filtered articles
        # directly matched *this* symbol's own proxy terms (vs being pulled in by
        # another symbol's terms).  Passed to Stage 2 so specialists can calibrate
        # their exposure_type and confidence when the match is weak.
        exposure_hints_by_symbol: Dict[str, str] = {}
        for sym, terms in proxy_terms_by_symbol.items():
            if not terms:
                exposure_hints_by_symbol[sym] = "BROAD"
                continue
            sym_expanded = expand_proxy_terms_for_matching(terms)
            sym_matches = sum(
                1 for post in filtered
                if any(
                    t in normalize_text_for_matching(
                        f"{getattr(post, 'title', '') or ''} "
                        f"{getattr(post, 'content', '') or ''}"
                    )
                    for t in sym_expanded
                )
            )
            ratio = sym_matches / max(1, len(filtered))
            if ratio >= 0.5:
                exposure_hints_by_symbol[sym] = "DIRECT"
            elif ratio >= 0.15:
                exposure_hints_by_symbol[sym] = "INDIRECT"
            else:
                exposure_hints_by_symbol[sym] = "BROAD"

        return {
            "filtered_posts": filtered,
            "proxy_terms_by_symbol": proxy_terms_by_symbol,
            "exposure_hints_by_symbol": exposure_hints_by_symbol,
            "keyword_generation_trace_by_symbol": {
                sym: dict(_keyword_trace_cache.get(sym.upper(), {}))
                for sym in symbols
            },
        }

    @staticmethod
    def _is_large_model(model_name: str) -> bool:
        """Return True for models ≥ 7B so we can set keep_alive to prevent unloading."""
        import re
        m = re.search(r"(\d+\.?\d*)b", model_name.lower())
        if m:
            return float(m.group(1)) >= 7
        return False

    def _call_ollama_sync(
        self,
        prompt: str,
        model_override: Optional[str] = None,
        force_json: bool = False,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        model = (model_override or self.model_name or "").strip()
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "think": False,  # Disables Qwen3 thinking mode; response goes to "response" field
            "options": {
                "temperature": self.TEMPERATURE,
                "num_predict": max_tokens if max_tokens is not None else self.MAX_TOKENS,
            },
        }
        if force_json:
            payload["format"] = "json"
        # Prevent large models from unloading between batches
        if self._is_large_model(model):
            payload["keep_alive"] = "10m"

        start_time = time.time()

        try:
            response = self.session.post(
                self.api_url,
                json=payload,
                timeout=300,
            )
            response.raise_for_status()

            result = response.json()
            latency = (time.time() - start_time) * 1000
            print(f"Ollama [{model}] completed in {latency:.1f}ms")
            return result

        except requests.exceptions.Timeout:
            raise Exception("Ollama API timeout")
        except requests.exceptions.ConnectionError:
            raise Exception("Cannot connect to Ollama. Is it running?")
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON response from Ollama: {e}")
        except Exception as e:
            raise Exception(f"Ollama API error: {e}")
    
    def _parse_response(
        self,
        ollama_response: Dict[str, Any],
        text_source: str
    ) -> SentimentAnalysisResponse:
        """
        Parse Ollama response into structured data.
        
        Args:
            ollama_response: Raw response from Ollama API
            text_source: Source identifier
            
        Returns:
            SentimentAnalysisResponse with parsed data
        """
        # Extract the JSON from the LLM response
        raw_text = ollama_response.get("response", "")
        raw_text = self._strip_thinking(raw_text)

        try:
            json_start = raw_text.find("{")
            json_end = raw_text.rfind("}") + 1

            if json_start >= 0 and json_end > json_start:
                json_str = self._sanitize_json(raw_text[json_start:json_end])
            else:
                json_str = self._sanitize_json(raw_text)

            data = self._parse_json_with_repair(json_str)

        except json.JSONDecodeError:
            raise ValueError(
                f"Model did not return valid JSON. Raw response:\n{raw_text[:500]}"
            )
        
        # ── Detect extraction format (new) vs legacy float format (old) ────────
        is_extraction_format = "symbol_relevance" in data or (
            "event_type" in data and "confirmed" in data
        )

        if is_extraction_format:
            # New path: LLM extracted facts, Python computes scores
            # We need the symbol to score — pull it from symbol_relevance keys or fall back
            sym_keys = list((data.get("symbol_relevance") or {}).keys())
            symbol_for_scoring = sym_keys[0] if sym_keys else ""
            computed = self.compute_symbol_scores(data, symbol_for_scoring)

            bluster = {
                "is_bluster": computed["is_bluster"],
                "bluster_score": computed["bluster_score"],
                "confidence": computed["confidence"],
                "reasoning": (data.get("analyst_writeup") or ""),
                "bluster_indicators": data.get("bluster_phrases") or [],
            }
            policy = {
                "is_policy_change": computed["is_policy_change"],
                "policy_score": computed["policy_score"],
                "impact_severity": computed["impact_severity"],
                "confidence": computed["confidence"],
                "reasoning": (data.get("analyst_writeup") or ""),
                "policy_indicators": data.get("substance_phrases") or [],
            }
            _trading_type = str(data.get("trading_type") or "SWING").upper()
            _exposure_type = computed.get("exposure_type", "DIRECT")
            _holding_lookup = {"SCALP": 2, "VOLATILE_EVENT": 3, "SWING": 12, "POSITION": 72}
            _urgency_map = {"SCALP": "HIGH", "VOLATILE_EVENT": "HIGH", "SWING": "MEDIUM", "POSITION": "LOW"}
            _conviction_map = {"SCALP": "LOW", "VOLATILE_EVENT": "MEDIUM", "SWING": "MEDIUM", "POSITION": "HIGH"}
            _urgency = _urgency_map.get(_trading_type, "MEDIUM")
            _conviction = _conviction_map.get(_trading_type, "MEDIUM")
            if _exposure_type == "UNRELATED":
                _conviction = "LOW"
            elif _exposure_type == "BROAD" and _conviction == "HIGH":
                _conviction = "MEDIUM"
            signal = {
                "signal_type": computed["signal_type"],
                "confidence_score": computed["confidence"],
                "urgency": _urgency,
                "entry_symbol": symbol_for_scoring,
                "reasoning": (data.get("analyst_writeup") or ""),
                "conviction_level": _conviction,
                "trading_type": _trading_type,
                "holding_period_hours": _holding_lookup.get(_trading_type, 12),
            }
            # Inject computed directional_score into data so downstream can read it
            data["_computed_directional_score"] = computed["directional_score"]
        else:
            # Legacy path: accept both nested basket-level JSON and flatter specialist JSON.
            bluster = data.get("market_bluster", {})
            policy = data.get("policy_change", {})
            signal = data.get("trading_signal", {})
            if not bluster and "bluster_score" in data:
                bluster = {
                    "is_bluster": data.get("is_bluster", False),
                    "bluster_score": data.get("bluster_score", 0.0),
                    "confidence": data.get("confidence", 0.5),
                    "reasoning": data.get("reasoning", ""),
                }
            if not policy and "policy_score" in data:
                policy = {
                    "is_policy_change": data.get("is_policy_change", False),
                    "policy_score": data.get("policy_score", 0.0),
                    "impact_severity": data.get("impact_severity", "low"),
                    "confidence": data.get("confidence", 0.5),
                    "reasoning": data.get("reasoning", ""),
                }
            if not signal and "signal_type" in data:
                signal = {
                    "signal_type": data.get("signal_type", "HOLD"),
                    "confidence_score": data.get("confidence", 0.5),
                    "urgency": data.get("urgency", "LOW"),
                    "entry_symbol": data.get("entry_symbol", ""),
                    "reasoning": data.get("reasoning", ""),
                }
        supporting_points = data.get("supporting_points", []) or []
        headline_citations = data.get("headline_citations", []) or []
        analyst_writeup = self._build_analyst_writeup(
            data=data,
            bluster=bluster,
            policy=policy,
            signal=signal,
            supporting_points=supporting_points,
            headline_citations=headline_citations,
        )
        directional_score = self._resolve_directional_score(
            data=data,
            signal=signal,
            policy=policy,
            bluster=bluster,
            reasoning=analyst_writeup,
        )
        
        return SentimentAnalysisResponse(
            request_id="",  # Would be generated by caller
            timestamp=datetime.utcnow(),
            is_bluster=bluster.get("is_bluster", False),
            bluster_score=float(bluster.get("bluster_score", 0.0)),
            bluster_indicators=bluster.get("bluster_indicators", []),
            is_policy_change=policy.get("is_policy_change", False),
            policy_score=float(policy.get("policy_score", 0.0)),
            policy_indicators=policy.get("policy_indicators", []),
            impact_severity=policy.get("impact_severity", "low"),
            confidence=float(bluster.get("confidence", 0.5) * 0.6 + policy.get("confidence", 0.5) * 0.4),
            reasoning=analyst_writeup,
            directional_score=directional_score,
            signal_type=str(signal.get("signal_type", "HOLD")).upper(),
            urgency=str(signal.get("urgency", "LOW")).upper(),
            entry_symbol=str(signal.get("entry_symbol", "")),
            analyst_writeup=analyst_writeup,
            supporting_points=supporting_points,
            headline_citations=headline_citations,
            symbol_impacts=data.get("symbol_impacts", {}) or {},
            raw_model_response=raw_text,
            parsed_payload=data,
        )

    @staticmethod
    def _build_analyst_writeup(
        data: Dict[str, Any],
        bluster: Dict[str, Any],
        policy: Dict[str, Any],
        signal: Dict[str, Any],
        supporting_points: List[str],
        headline_citations: List[str],
    ) -> str:
        """Prefer the model's full analyst writeup, with a structured fallback."""
        analyst_writeup = (data.get("analyst_writeup") or "").strip()
        if analyst_writeup:
            return analyst_writeup

        parts: List[str] = []
        signal_type = signal.get("signal_type", "HOLD")
        signal_reason = (signal.get("reasoning") or "").strip()
        overall = (data.get("overall_assessment") or "").strip()
        bluster_reason = (bluster.get("reasoning") or "").strip()
        policy_reason = (policy.get("reasoning") or "").strip()

        if overall:
            parts.append(overall)
        if signal_reason:
            parts.append(f"Signal rationale: {signal_type} because {signal_reason}")
        if headline_citations:
            parts.append("Key items: " + "; ".join(headline_citations[:4]))
        if supporting_points:
            parts.append("Supporting evidence: " + "; ".join(supporting_points[:4]))
        if bluster_reason:
            parts.append(f"Bluster view: {bluster_reason}")
        if policy_reason:
            parts.append(f"Policy view: {policy_reason}")

        fallback = "\n\n".join(part for part in parts if part)
        if fallback:
            return fallback
        try:
            _bluster_val = abs(float(bluster.get("bluster_score", 0.0)))
            _policy_val = float(policy.get("policy_score", 0.0))
        except (TypeError, ValueError):
            _bluster_val = _policy_val = 0.0
        if _bluster_val < 0.05 and _policy_val < 0.05 and str(signal.get("signal_type", "HOLD")).upper() == "HOLD":
            return (
                "No direct transmission path identified for this symbol in the current news cycle. "
                "The articles reflect macro or broad market themes but do not have a specific causal "
                "mechanism that scores above the signal threshold for this instrument. Holding."
            )
        return "The model did not provide a detailed writeup for this signal."

    @staticmethod
    def _resolve_directional_score(
        data: Dict[str, Any],
        signal: Dict[str, Any],
        policy: Dict[str, Any],
        bluster: Dict[str, Any],
        reasoning: str,
    ) -> float:
        """Use Python-computed directional score (extraction format) or infer from legacy floats."""
        # Extraction format: Python already computed this in _parse_response
        try:
            if "_computed_directional_score" in data:
                return float(data["_computed_directional_score"])
        except (TypeError, ValueError):
            pass
        # Legacy float format
        try:
            if "directional_score" in data and data.get("directional_score") is not None:
                return max(-1.0, min(1.0, float(data.get("directional_score"))))
        except (TypeError, ValueError):
            pass

        signal_type = str(signal.get("signal_type", "HOLD")).upper().strip()
        try:
            policy_score = max(0.0, min(1.0, float(policy.get("policy_score", 0.0))))
        except (TypeError, ValueError):
            policy_score = 0.0
        try:
            bluster_score = max(-1.0, min(1.0, float(bluster.get("bluster_score", 0.0))))
        except (TypeError, ValueError):
            bluster_score = 0.0

        if signal_type == "LONG":
            return min(1.0, max(0.15, policy_score))
        if signal_type == "SHORT":
            return max(-1.0, min(-0.15, -max(abs(bluster_score), policy_score)))

        lowered = (reasoning or "").lower()
        positive_hints = ["bullish", "beneficiary", "re-rate higher", "rally", "positive for"]
        negative_hints = ["bearish", "headwind", "sell-off", "negative for", "pressure on"]
        if any(token in lowered for token in positive_hints):
            return min(1.0, max(0.1, policy_score * 0.8))
        if any(token in lowered for token in negative_hints):
            return max(-1.0, min(-0.1, -max(abs(bluster_score), policy_score * 0.8)))
        return 0.0
    
    def get_cached_result(self, key: str) -> Optional[SentimentAnalysisResponse]:
        """Get a cached result by key."""
        if key in self._cache:
            cached = self._cache[key]
            if (datetime.utcnow() - cached.timestamp).total_seconds() < self._cache_ttl:
                return cached
            else:
                del self._cache[key]
        return None
