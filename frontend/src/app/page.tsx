"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Activity, WifiOff, ArrowRight, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Clock, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SentimentTicker from "@/components/Dashboard/SentimentTicker";
import { formatTs, formatTime, useTimezone } from "@/lib/timezone";

// ─── Types ──────────────────────────────────────────────────────────────────

type FeedItem =
    | { kind: "log"; message: string }
    | { kind: "article"; idx: number; source: string; title: string; description: string; keywords: string[] };

type PriceQuote = {
    price: number;
    change: number;
    change_pct: number;
    day_low: number;
    day_high: number;
    session?: "regular" | "premarket" | "postmarket" | "closed" | string;
    as_of?: string;
    source?: string;
    is_stale?: boolean;
    cache_ttl_seconds?: number;
};
type Prices = Record<string, PriceQuote>;
type MarketValidationMetric = {
    name: string;
    label: string;
    source: string;
    source_url: string;
    unit?: string;
    current?: number;
    previous?: number | null;
    delta?: number | null;
    direction?: string;
    as_of?: string;
    status: string;
    error?: string;
};
type MarketValidationPayload = {
    status: string;
    summary: string;
    metrics: MarketValidationMetric[];
    sources: string[];
    updated_at: string;
};
type ModelInputArticle = {
    source: string;
    title: string;
    description: string;
    content?: string;
    keywords: string[];
};
type ModelInputWebItem = {
    source: string;
    title: string;
    url: string;
    published_at: string;
    summary: string;
    query: string;
    relevance_score: number;
    age_days: number;
    matched_keywords: string[];
};
type ModelInputDebug = {
    news_context: string;
    validation_context: string;
    price_context: Record<string, number>;
    articles: ModelInputArticle[];
    per_symbol_prompts: Record<string, string>;
    web_context_by_symbol: Record<string, string>;
    web_items_by_symbol: Record<string, ModelInputWebItem[]>;
};
type IngestionTraceArticle = {
    source: string;
    title: string;
    summary: string;
    content?: string;
    keywords: string[];
};
type IngestionTrace = {
    source: string;
    trigger_source: string;
    request_max_posts?: number | null;
    selected_article_ids: number[];
    selected_fast_lane_article_ids: number[];
    total_items: number;
    queue?: {
        status?: string;
        pending_count?: number;
        selected_count?: number;
        selected_articles?: IngestionTraceArticle[];
        selected_urls?: string[];
        fast_lane_count?: number;
    } | null;
    truth_social?: Record<string, any> | null;
    rss?: Record<string, any> | null;
};

type Recommendation = {
    action: "BUY" | "SELL";
    symbol: string;
    leverage: string;
    underlying_symbol?: string;
    thesis?: "LONG" | "SHORT";
};

type RedTeamSymbolReview = {
    symbol: string;
    current_recommendation: string;
    thesis: string;
    antithesis: string;
    evidence: string[];
    key_risks: string[];
    adjusted_signal: "BUY" | "SELL" | "HOLD";
    adjusted_confidence: number;
    adjusted_urgency: "LOW" | "MEDIUM" | "HIGH";
    stop_loss_pct: number;
    atr_basis: string;
    rationale: string;
};

type RedTeamReview = {
    summary: string;
    portfolio_risks: string[];
    source_bias_penalty_applied: boolean;
    source_bias_notes: string;
    symbol_reviews: RedTeamSymbolReview[];
};

type RedTeamSignalChange = {
    symbol: string;
    blue_team_recommendation: string;
    consensus_recommendation: string;
    changed: boolean;
    change_type: string;
    rationale: string;
    evidence: string[];
};

type RedTeamDebug = {
    context: Record<string, any>;
    prompt: string;
    raw_response: string;
    parsed_payload: Record<string, any>;
    signal_changes: RedTeamSignalChange[];
};

function describeRecommendation(rec: Recommendation) {
    const underlying = rec.underlying_symbol || rec.symbol;
    const isProxy = rec.symbol !== underlying;
    if (rec.thesis === "SHORT") {
        return isProxy
            ? `${rec.action} ${rec.symbol} expresses a bearish ${underlying} view`
            : `${rec.action} ${underlying} is a direct bearish ${underlying} trade`;
    }
    if (rec.thesis === "LONG") {
        return isProxy
            ? `${rec.action} ${rec.symbol} expresses a bullish ${underlying} view`
            : `${rec.action} ${underlying} is a direct bullish ${underlying} trade`;
    }
    return `${rec.action} ${rec.symbol}`;
}

function recommendationTooltipLines(rec: Recommendation) {
    const underlying = rec.underlying_symbol || rec.symbol;
    const thesisLabel = rec.thesis === "SHORT" ? `Bearish ${underlying}` : `Bullish ${underlying}`;
    const executionLine = rec.symbol === underlying
        ? `${rec.action} ${rec.symbol} directly`
        : `${rec.action} ${rec.symbol} as the tradable proxy`;
    return [thesisLabel, executionLine, `Leverage target: ${rec.leverage}`];
}

function RecommendationTooltip({ rec }: { rec: Recommendation }) {
    const lines = recommendationTooltipLines(rec);
    return (
        <span className="relative inline-flex items-center group">
            <span
                tabIndex={0}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-white/70 outline-none transition-colors hover:text-white focus:text-white"
                aria-label={describeRecommendation(rec)}
            >
                <Info size={11} />
            </span>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-left text-[11px] font-medium text-slate-200 opacity-0 shadow-2xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {lines.map((line) => (
                    <span key={line} className="block leading-relaxed">
                        {line}
                    </span>
                ))}
            </span>
        </span>
    );
}

function formatSnapshotLabel(snapshot: AnalysisSnapshotItem, timeZone: string) {
    const timestamp = snapshot.timestamp ? formatTs(snapshot.timestamp, timeZone) : "Unknown time";
    const ext = snapshot.extraction_model?.trim();
    const rsn = snapshot.reasoning_model?.trim();
    let modelLabel: string;
    if (ext && rsn && ext !== rsn) {
        modelLabel = `${ext} / ${rsn}`;
    } else {
        modelLabel = ext || rsn || snapshot.model_name || "unknown model";
    }
    return `${timestamp} · ${snapshot.request_id} · ${modelLabel}`;
}

function compactReasoning(reasoning?: string | null) {
    const text = (reasoning || "").replace(/\s+/g, " ").trim();
    if (!text) return "No saved reasoning.";
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
    return firstSentence.length > 220 ? `${firstSentence.slice(0, 217)}...` : firstSentence;
}

const STAGE_COMPARE_ORDER: Array<{ key: string; label: string }> = [
    { key: "ingest", label: "Ingest" },
    { key: "stage1", label: "Stage 1" },
    { key: "stage2", label: "Stage 2" },
    { key: "red_team", label: "Red Team" },
];

function StageMetricsComparison({
    baseline,
    comparison,
}: {
    baseline?: AnalysisResult | null;
    comparison?: AnalysisResult | null;
}) {
    const baselineMetrics = baseline?.stage_metrics || {};
    const comparisonMetrics = comparison?.stage_metrics || {};
    const hasMetrics = STAGE_COMPARE_ORDER.some(({ key }) => baselineMetrics[key] || comparisonMetrics[key]);
    if (!hasMetrics) return null;

    return (
        <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 overflow-hidden mb-4">
            <div className="grid grid-cols-3 gap-3 px-3 py-2 border-b border-slate-700/50 bg-slate-900/30 text-[10px] uppercase tracking-wider text-slate-500">
                <span>Stage</span>
                <span>Baseline</span>
                <span>Comparison</span>
            </div>
            {STAGE_COMPARE_ORDER.map(({ key, label }) => {
                const left = baselineMetrics[key];
                const right = comparisonMetrics[key];
                return (
                    <div key={key} className="grid grid-cols-3 gap-3 px-3 py-2.5 border-b border-slate-800/60 last:border-0">
                        <p className="text-xs font-semibold text-slate-200">{label}</p>
                        <div>
                            {left ? (
                                <>
                                    <p className="text-xs text-slate-200">{(left.duration_ms / 1000).toFixed(2)}s</p>
                                    <p className="text-[10px] text-slate-500 font-mono break-all">{left.model_name || left.status}</p>
                                </>
                            ) : (
                                <p className="text-[10px] text-slate-600 italic">—</p>
                            )}
                        </div>
                        <div>
                            {right ? (
                                <>
                                    <p className="text-xs text-slate-200">{(right.duration_ms / 1000).toFixed(2)}s</p>
                                    <p className="text-[10px] text-slate-500 font-mono break-all">{right.model_name || right.status}</p>
                                </>
                            ) : (
                                <p className="text-[10px] text-slate-600 italic">—</p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function percentile(sorted: number[], p: number) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function estimateRunTiming(samples: number[], fallbackSeconds: number) {
    const cleaned = samples
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(-8)
        .sort((a, b) => a - b);

    if (cleaned.length < 2) {
        const fallback = Math.max(15, Math.round(fallbackSeconds || 82));
        return {
            expectedSeconds: fallback,
            pacingSeconds: fallback,
            reliable: false,
        };
    }

    const trimmed = cleaned.length >= 5 ? cleaned.slice(1, -1) : cleaned;
    const mean = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    const median = percentile(cleaned, 0.5);
    const p75 = percentile(cleaned, 0.75);
    const variance = trimmed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / trimmed.length;
    const stdDev = Math.sqrt(variance);
    const expectedSeconds = Math.max(15, Math.round((mean + median) / 2));
    const pacingSeconds = Math.max(expectedSeconds, Math.round(Math.max(p75, expectedSeconds + stdDev * 0.35)));

    return {
        expectedSeconds,
        pacingSeconds,
        reliable: true,
    };
}

function formatSignedScore(value?: number | null, digits = 2) {
    const numeric = Number(value ?? 0);
    return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}`;
}

function buildChangeDrivers(
    underlying: string,
    baselineRec: Recommendation | undefined,
    comparisonRec: Recommendation | undefined,
    baselineSentiment: SentimentEntry | undefined,
    comparisonSentiment: SentimentEntry | undefined,
) {
    const drivers: string[] = [];
    const policyBefore = baselineSentiment?.policy_change;
    const policyAfter = comparisonSentiment?.policy_change;
    const blusterBefore = baselineSentiment?.market_bluster;
    const blusterAfter = comparisonSentiment?.market_bluster;
    const confidenceBefore = baselineSentiment?.confidence;
    const confidenceAfter = comparisonSentiment?.confidence;

    if (baselineRec && comparisonRec) {
        if (baselineRec.action !== comparisonRec.action) {
            drivers.push(`Trade direction flipped from ${baselineRec.action} to ${comparisonRec.action}.`);
        } else if (baselineRec.symbol !== comparisonRec.symbol) {
            drivers.push(`Execution proxy changed from ${baselineRec.symbol} to ${comparisonRec.symbol} while keeping the same ${underlying} thesis.`);
        }

        if (baselineRec.leverage !== comparisonRec.leverage) {
            drivers.push(`Leverage changed from ${baselineRec.leverage} to ${comparisonRec.leverage}.`);
        }
    } else if (baselineRec && !comparisonRec) {
        drivers.push(`The earlier run had a ${underlying} trade, but the later run removed it.`);
    } else if (!baselineRec && comparisonRec) {
        drivers.push(`The later run added a new ${underlying} trade that was not present before.`);
    }

    if (policyBefore !== undefined || policyAfter !== undefined || blusterBefore !== undefined || blusterAfter !== undefined) {
        drivers.push(
            `Policy ${formatSignedScore(policyBefore)} -> ${formatSignedScore(policyAfter)}; bluster ${formatSignedScore(blusterBefore)} -> ${formatSignedScore(blusterAfter)}.`
        );
    }

    if (
        baselineRec &&
        comparisonRec &&
        baselineRec.action === comparisonRec.action &&
        baselineRec.leverage !== comparisonRec.leverage &&
        confidenceBefore !== undefined &&
        confidenceAfter !== undefined
    ) {
        const crossedThreshold =
            (confidenceBefore >= 0.75 && confidenceAfter < 0.75) ||
            (confidenceBefore < 0.75 && confidenceAfter >= 0.75);
        if (crossedThreshold) {
            drivers.push(`Confidence moved ${confidenceBefore.toFixed(2)} -> ${confidenceAfter.toFixed(2)}, which likely crossed the 0.75 leverage threshold.`);
        } else {
            drivers.push(`Confidence moved ${confidenceBefore.toFixed(2)} -> ${confidenceAfter.toFixed(2)}.`);
        }
    } else if (confidenceBefore !== undefined || confidenceAfter !== undefined) {
        drivers.push(`Confidence ${Number(confidenceBefore ?? 0).toFixed(2)} -> ${Number(confidenceAfter ?? 0).toFixed(2)}.`);
    }

    return drivers;
}

type SentimentEntry = {
    market_bluster: number;
    policy_change: number;
    confidence: number;
    reasoning: string;
};
type ActualExecution = {
    id: number;
    executed_action: "BUY" | "SELL";
    executed_price: number;
    executed_at: string;
    notes: string;
};
type TradeComparison = {
    latest_horizon: string;
    recommended_return_pct: number;
    actual_return_pct: number;
    following_was_better_pct: number;
    recommended_paper_pnl_usd?: number;
    actual_paper_pnl_usd?: number;
    following_was_better_usd?: number;
    snapshot_price?: number;
    snapshot_observed_at?: string;
};
type TradeCloseRecord = {
    id: number;
    closed_price: number;
    closed_at: string;
    notes: string;
    closed_return_pct: number;
    paper_pnl_usd?: number;
    exec_closed_return_pct?: number | null;
    exec_paper_pnl_usd?: number | null;
};

type PnLTrade = {
    id: number;
    request_id: string;
    symbol: string;
    underlying_symbol?: string;
    action: "BUY" | "SELL";
    leverage: string;
    entry_price: number;
    paper_notional_usd?: number;
    paper_shares?: number;
    snapshots?: Record<string, {
        target_timestamp: string;
        observed_at: string;
        observed_price: number;
        raw_return_pct: number;
        leveraged_return_pct: number;
        paper_pnl_usd?: number;
    }>;
    recommended_at?: string;
    actual_execution?: ActualExecution | null;
    comparison?: TradeComparison | null;
    trade_close?: TradeCloseRecord | null;
};
type PnLSummary = {
    execution_summary: {
        executed_trades: number;
        matched_recommendation: number;
        avg_latest_recommended_return_pct: number;
        avg_latest_actual_return_pct: number;
        match_rate: number;
    };
    paper_trade_notional_usd?: number;
    trades: PnLTrade[];
};
type OllamaStatus = {
    reachable: boolean;
    ollama_root?: string;
    configured_model?: string;
    active_model?: string;
    available_models?: string[];
    resolution?: string;
    error?: string;
};

type AnalysisStage = {
    key: string;
    label: string;
    weight: number;
    matches: string[];
};

type AppConfig = {
    auto_run_enabled: boolean;
    auto_run_interval_minutes: number;
    tracked_symbols: string[];
    custom_symbols: string[];
    default_symbols: string[];
    max_custom_symbols: number;
    max_posts: number;
    lookback_days: number;
    symbol_prompt_overrides: Record<string, string>;
    display_timezone: string;
    default_rss_feeds: Array<{ key: string; label: string; url: string }>;
    custom_rss_feeds: string[];
    enabled_rss_feeds: string[];
    supported_rss_feeds: Array<{ key: string; label: string; url: string }>;
    max_custom_rss_feeds: number;
    snapshot_retention_limit: number;
    last_analysis_started_at: string | null;
    last_analysis_completed_at: string | null;
    last_analysis_request_id: string | null;
    seconds_until_next_auto_run: number;
    can_auto_run_now: boolean;
    supported_symbols: string[];
    estimated_analysis_seconds: number;
    recent_analysis_seconds?: number[];
    extraction_model?: string;
    reasoning_model?: string;
    rss_article_detail_mode?: "light" | "normal" | "detailed";
    risk_profile?: string;
};
type AnalysisResult = {
    request_id: string;
    symbols_analyzed: string[];
    posts_scraped: number;
    sentiment_scores: Record<string, SentimentEntry>;
    aggregated_sentiment?: SentimentEntry | null;
    trading_signal?: any;
    blue_team_signal?: any;
    market_validation: Record<string, MarketValidationPayload>;
    model_inputs?: ModelInputDebug | null;
    ingestion_trace?: IngestionTrace | null;
    red_team_review?: RedTeamReview | null;
    red_team_debug?: RedTeamDebug | null;
    stage_metrics?: Record<string, {
        status: "completed" | "skipped";
        model_name: string;
        duration_ms: number;
        item_count?: number | null;
        details?: Record<string, any>;
    }>;
    processing_time_ms: number;
};
type SnapshotRecommendation = {
    action: string;
    symbol: string;
    leverage: string;
    underlying_symbol?: string;
};

type AnalysisSnapshotItem = {
    request_id: string;
    timestamp: string | null;
    model_name: string;
    symbols: string[];
    posts_scraped: number;
    snapshot_available: boolean;
    snapshot_article_count: number;
    extraction_model?: string;
    reasoning_model?: string;
    risk_profile?: string;
    signal_type?: "LONG" | "SHORT" | "HOLD";
    confidence_score?: number;
    recommendations?: SnapshotRecommendation[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_APP_CONFIG: AppConfig = {
    auto_run_enabled: true,
    auto_run_interval_minutes: 30,
    tracked_symbols: ["USO", "BITO", "QQQ", "SPY"],
    custom_symbols: [],
    default_symbols: ["USO", "BITO", "QQQ", "SPY"],
    max_custom_symbols: 3,
    max_posts: 50,
    lookback_days: 14,
    symbol_prompt_overrides: {},
    display_timezone: "",
    default_rss_feeds: [],
    custom_rss_feeds: [],
    enabled_rss_feeds: [],
    supported_rss_feeds: [],
    max_custom_rss_feeds: 3,
    snapshot_retention_limit: 12,
    last_analysis_started_at: null,
    last_analysis_completed_at: null,
    last_analysis_request_id: null,
    seconds_until_next_auto_run: 0,
    can_auto_run_now: true,
    supported_symbols: ["USO", "BITO", "QQQ", "SPY"],
    estimated_analysis_seconds: 82,
    recent_analysis_seconds: [],
    extraction_model: "",
    reasoning_model: "",
    rss_article_detail_mode: "normal",
    risk_profile: "moderate",
};

const LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY = "lastViewedAnalysisRequestId";
const GOLDEN_DATASET_REQUEST_ID_KEY = "goldenDatasetRequestId";
const ANALYSIS_STAGES: AnalysisStage[] = [
    { key: "preflight", label: "Checking model", weight: 0.08, matches: ["Ollama reachable"] },
    { key: "ingestion", label: "Collecting live feeds", weight: 0.24, matches: ["Fetching ", "articles", "Ingestion complete"] },
    { key: "prices", label: "Loading market prices", weight: 0.08, matches: ["Fetching real-time price data", "Price data fetched"] },
    { key: "sentiment", label: "Running symbol specialists", weight: 0.38, matches: ["Running Qwen", "bluster=", "confidence="] },
    { key: "signal", label: "Building trade signals", weight: 0.22, matches: ["Generating trading signal", "Signal: "] },
];
const SIGNAL_RULES = [
    { border: "border-l-red-500", bg: "bg-red-500/5", label: "SHORT", labelColor: "text-red-400", desc: "Bluster < −0.5 & Policy < 0.3" },
    { border: "border-l-emerald-500", bg: "bg-emerald-500/5", label: "LONG", labelColor: "text-emerald-400", desc: "Policy Change > 0.7" },
    { border: "border-l-slate-600", bg: "bg-slate-800/30", label: "HOLD", labelColor: "text-slate-400", desc: "Default Condition" },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`rounded-2xl p-5 ${className}`}
            style={{ background: "rgba(30,41,59,0.75)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {children}
        </div>
    );
}

function PriceRow({ symbol, q }: { symbol: string; q: PriceQuote }) {
    const { timeZone } = useTimezone();
    const up = q.change_pct >= 0;
    const session = String(q.session || "closed");
    const sessionLabel = session === "premarket"
        ? "Pre-Market"
        : session === "postmarket"
            ? "Post-Market"
            : session === "regular"
                ? "Market"
                : "Closed";
    const sessionTone = q.is_stale
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : session === "regular"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : session === "premarket" || session === "postmarket"
                ? "border-blue-500/30 bg-blue-500/10 text-blue-200"
                : "border-slate-600 bg-slate-800/60 text-slate-300";
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-slate-700/40 last:border-0">
            <div>
                <span className="text-xs font-mono font-bold text-slate-300">{symbol}</span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${sessionTone}`}>
                        {q.is_stale ? `Stale ${sessionLabel}` : sessionLabel}
                    </span>
                    {q.as_of && (
                        <span className="text-[10px] text-slate-500">
                            {formatTime(q.as_of, timeZone)}
                        </span>
                    )}
                </div>
            </div>
            <div className="text-right">
                <span className="text-xs font-mono text-white">${q.price.toFixed(2)}</span>
                <span className={`ml-2 text-[10px] font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>
                    {up ? "+" : ""}{q.change_pct.toFixed(2)}%
                </span>
            </div>
        </div>
    );
}

function inferArticleSymbol(item: FeedItem & { kind: "article" }, sentimentScores?: Record<string, SentimentEntry>): string | null {
    const sourcePrefix = String(item.source || "").split("·")[0].trim().toUpperCase();
    if (sourcePrefix && sentimentScores?.[sourcePrefix]) {
        return sourcePrefix;
    }

    const normalizedKeywords = new Set(item.keywords.map((keyword) => keyword.trim().toUpperCase()).filter(Boolean));
    const matchingSymbols = Object.keys(sentimentScores || {}).filter((symbol) => normalizedKeywords.has(symbol.toUpperCase()));
    if (matchingSymbols.length === 1) {
        return matchingSymbols[0];
    }
    return null;
}

function getArticleAssessment(item: FeedItem & { kind: "article" }, result: any) {
    const symbol = inferArticleSymbol(item, result?.sentiment_scores);
    if (!symbol) return null;

    const sentiment = result?.sentiment_scores?.[symbol];
    if (!sentiment) return null;

    const recommendation = (result?.trading_signal?.recommendations || []).find(
        (rec: any) => rec?.underlying_symbol === symbol
    );

    return {
        symbol,
        signalType: recommendation?.thesis || result?.trading_signal?.signal_type || "HOLD",
        confidence: typeof sentiment.confidence === "number"
            ? Math.round(sentiment.confidence * 100)
            : (result?.trading_signal ? Math.round(result.trading_signal.confidence_score * 100) : 0),
        reasoning: String(sentiment.reasoning || "").trim(),
    };
}

function ArticleCard({ item, expanded, onToggle, result }: {
    item: FeedItem & { kind: "article" };
    expanded: boolean;
    onToggle: () => void;
    result: any;
}) {
    const keywords = Array.from(
        new Set(item.keywords.map((keyword) => keyword.trim()).filter(Boolean))
    );
    const assessment = getArticleAssessment(item, result);
    const signalColor = assessment?.signalType === "LONG" ? "text-emerald-400" :
        assessment?.signalType === "SHORT" ? "text-red-400" : "text-slate-500";

    return (
        <div className="mb-2 rounded-xl border border-slate-700/60 overflow-hidden bg-slate-800/40 cursor-pointer"
            onClick={onToggle}>
            <div className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">{item.source}</span>
                    <p className={`text-sm text-slate-200 leading-snug mt-0.5 ${!expanded ? "line-clamp-2" : "whitespace-pre-wrap"}`}>
                        {item.title}
                    </p>
                </div>
                <div className="shrink-0 mt-0.5 text-slate-500">
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
            </div>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 pb-3 space-y-2 border-t border-slate-700/40 pt-2">
                            {item.description && item.description !== item.title && (
                                <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                            )}
                            {keywords.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {keywords.map((kw) => (
                                        <span key={`${item.idx}-${kw}`} className="text-[10px] bg-blue-500/15 text-blue-300 px-2 py-0.5 rounded border border-blue-500/20">
                                            #{kw}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {assessment && (
                                <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-700/40">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                        {assessment.symbol} Assessment
                                    </p>
                                    <p className={`text-xs font-semibold ${signalColor}`}>
                                        Signal: {assessment.signalType}  ·  Confidence: {assessment.confidence}%
                                    </p>
                                    {assessment.reasoning && (
                                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                            {assessment.reasoning.slice(0, 200)}…
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function RecommendationBadge({
    rec,
    onClick,
    hasExecution,
}: {
    rec: Recommendation;
    onClick?: () => void;
    hasExecution?: boolean;
}) {
    const isBuy = rec.action === "BUY";
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-col items-start gap-1 px-4 py-2 rounded-lg border font-bold text-sm ${isBuy
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/15 border-red-500/30 text-red-300"
                } ${onClick ? "hover:bg-white/10 cursor-pointer" : "cursor-default"}`}>
            <div className="flex items-center gap-2">
                {isBuy ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                <span>{rec.action}</span>
                <span className="font-black">{rec.symbol}</span>
                <span className="font-mono text-xs opacity-70">{rec.leverage}</span>
                <RecommendationTooltip rec={rec} />
                {hasExecution && <span className="text-[10px] uppercase opacity-80">Logged</span>}
            </div>
            {rec.underlying_symbol && rec.underlying_symbol !== rec.symbol && (
                <span className="text-[11px] font-medium opacity-80">
                    {rec.thesis === "SHORT" ? `Short ${rec.underlying_symbol} proxy` : `Long ${rec.underlying_symbol} proxy`}
                </span>
            )}
        </button>
    );
}

function SignalHero({
    signal,
    redTeamReview,
    sentimentScores,
    trackedSymbols,
    trackedTrades,
    onRecommendationClick,
}: {
    signal: any;
    redTeamReview?: RedTeamReview | null;
    sentimentScores?: Record<string, SentimentEntry>;
    trackedSymbols: string[];
    trackedTrades?: PnLTrade[];
    onRecommendationClick?: (rec: Recommendation) => void;
}) {
    if (!signal) return null;
    const isBuy = signal.signal_type === "LONG";
    const isShort = signal.signal_type === "SHORT";
    const color = isBuy ? "text-emerald-400" : isShort ? "text-red-400" : "text-slate-400";
    const border = isBuy ? "border-emerald-500/40" : isShort ? "border-red-500/40" : "border-slate-600/40";
    const bg = isBuy ? "bg-emerald-500/8" : isShort ? "bg-red-500/8" : "bg-slate-800/30";
    const pct = Math.round(signal.confidence_score * 100);
    const recommendationMap = new Map<string, Recommendation>(
        (signal.recommendations ?? []).map((rec: Recommendation) => [rec.underlying_symbol || rec.symbol, rec])
    );
    const symbolWhyItems = trackedSymbols
        .filter((symbol) => sentimentScores?.[symbol])
        .map((symbol) => {
            const recommendation = recommendationMap.get(symbol);
            return {
                symbol,
                action: recommendation?.action ?? "HOLD",
                leverage: recommendation?.leverage ?? "",
                reasoning: sentimentScores?.[symbol]?.reasoning ?? "",
            };
        });
    const recommendations = signal.recommendations ?? [];

    return (
        <div className={`rounded-2xl border ${border} ${bg} p-5`}
            style={{ backdropFilter: "blur(12px)" }}>
            {recommendations.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                    {recommendations.map((r: Recommendation, i: number) => (
                        <RecommendationBadge
                            key={`${r.symbol}-${r.action}-${r.leverage || "na"}-${i}`}
                            rec={r}
                            onClick={() => onRecommendationClick?.(r)}
                            hasExecution={trackedTrades?.some((trade) => trade.symbol === r.symbol && trade.action === r.action && !!trade.actual_execution)}
                        />
                    ))}
                </div>
            )}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {isBuy ? <TrendingUp size={28} className="text-emerald-400" /> :
                        isShort ? <TrendingDown size={28} className="text-red-400" /> :
                            <Minus size={28} className="text-slate-400" />}
                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-widest">Signal</p>
                        <p className={`text-3xl font-black ${color}`}>
                            {isBuy ? "GO LONG" : isShort ? "GO SHORT" : "HOLD"}
                        </p>
                    </div>
                </div>
                <div className="text-right space-y-1">
                    <span className={`text-xs px-2 py-0.5 rounded border ${signal.urgency === "HIGH" ? "bg-red-500/10 border-red-500/20 text-red-400" :
                            signal.urgency === "MEDIUM" ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
                                "bg-slate-700 border-slate-600 text-slate-400"
                        }`}>{signal.urgency} URGENCY</span>
                </div>
            </div>

            <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Confidence</span>
                    <span className={`font-bold ${color}`}>{pct}%</span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className={`h-full rounded-full ${isBuy ? "bg-emerald-500" : isShort ? "bg-red-500" : "bg-slate-500"}`}
                    />
                </div>
            </div>

            {symbolWhyItems.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
                    {symbolWhyItems.map((item: { symbol: string; action: string; leverage: string; reasoning: string }, index: number) => {
                        const tone = item.action === "BUY"
                            ? "border-emerald-500/25 bg-emerald-500/8"
                            : item.action === "SELL"
                                ? "border-red-500/25 bg-red-500/8"
                                : "border-slate-600/40 bg-slate-800/40";
                        const labelColor = item.action === "BUY"
                            ? "text-emerald-300"
                            : item.action === "SELL"
                                ? "text-red-300"
                                : "text-slate-300";

                        return (
                            <div key={item.symbol || `symbol-why-${index}`} className={`rounded-xl border p-4 ${tone}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-base font-black text-white">{item.symbol}</p>
                                    <p className={`text-sm font-semibold text-right ${labelColor}`}>
                                        {item.action}{item.leverage ? ` ${item.leverage}` : ""}
                                        {recommendationMap.get(item.symbol)?.symbol && recommendationMap.get(item.symbol)?.symbol !== item.symbol
                                            ? ` ${recommendationMap.get(item.symbol)?.symbol}`
                                            : ""}
                                    </p>
                                </div>
                                <p className="text-sm leading-relaxed text-slate-300 mt-3">
                                    {item.reasoning || "No symbol-specific reasoning returned yet."}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {redTeamReview && (
                <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-300">Red Team Review</p>
                            <p className="text-sm text-slate-200 mt-1">{redTeamReview.summary || "Adversarial risk review completed."}</p>
                        </div>
                        {redTeamReview.source_bias_penalty_applied && (
                            <span className="text-[10px] uppercase rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-200">
                                Source Bias Penalty
                            </span>
                        )}
                    </div>
                    {redTeamReview.source_bias_notes && (
                        <p className="text-xs text-slate-300 mt-3 leading-relaxed">{redTeamReview.source_bias_notes}</p>
                    )}
                    {redTeamReview.portfolio_risks?.length > 0 && (
                        <div className="mt-3">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400">Portfolio Risks</p>
                            <div className="mt-1 space-y-1">
                                {redTeamReview.portfolio_risks.map((risk) => (
                                    <p key={risk} className="text-xs text-slate-300 leading-relaxed">{risk}</p>
                                ))}
                            </div>
                        </div>
                    )}
                    {redTeamReview.symbol_reviews?.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                            {redTeamReview.symbol_reviews.map((review) => (
                                <div key={review.symbol} className="rounded-xl border border-amber-500/20 bg-slate-950/35 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-base font-black text-white">{review.symbol}</p>
                                            <p className="text-xs text-slate-400 mt-1">{review.current_recommendation}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-semibold text-amber-300">{review.adjusted_signal}</p>
                                            <p className="text-[11px] text-slate-400 mt-1">
                                                {Math.round((review.adjusted_confidence || 0) * 100)}% · {review.adjusted_urgency}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 mt-3">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-emerald-300">Thesis</p>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{review.thesis || "No thesis returned."}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-red-300">Antithesis</p>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{review.antithesis || "No antithesis returned."}</p>
                                        </div>
                                    </div>
                                    {review.evidence?.length > 0 && (
                                        <div className="mt-3">
                                            <p className="text-[10px] uppercase tracking-wider text-blue-300">Evidence</p>
                                            <div className="mt-1 space-y-1">
                                                {review.evidence.map((item) => (
                                                    <p key={`${review.symbol}-${item}`} className="text-xs text-slate-300 leading-relaxed">{item}</p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {review.key_risks?.length > 0 && (
                                        <div className="mt-3">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400">Key Risks</p>
                                            <div className="mt-1 space-y-1">
                                                {review.key_risks.map((risk) => (
                                                    <p key={`${review.symbol}-${risk}`} className="text-xs text-slate-300 leading-relaxed">{risk}</p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 mt-3">
                                        <div className="rounded-lg bg-slate-900/70 p-2 text-center">
                                            <p className="text-[10px] text-slate-500">Adjusted Stop</p>
                                            <p className="text-sm font-bold text-amber-300">-{review.stop_loss_pct.toFixed(1)}%</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-900/70 p-2 text-center">
                                            <p className="text-[10px] text-slate-500">ATR Basis</p>
                                            <p className="text-[11px] font-medium text-slate-200">{review.atr_basis || "ATR unavailable"}</p>
                                        </div>
                                    </div>
                                    {review.rationale && (
                                        <p className="text-xs text-slate-300 mt-3 leading-relaxed">{review.rationale}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AnalysisStatusCard({
    stageLabel,
    progressPct,
    elapsedSeconds,
    etaSeconds,
    latestMessage,
    isWaitingForStream,
    hasReliableHistory,
}: {
    stageLabel: string;
    progressPct: number;
    elapsedSeconds: number;
    etaSeconds: number;
    latestMessage: string;
    isWaitingForStream: boolean;
    hasReliableHistory: boolean;
}) {
    const elapsed = `${Math.floor(elapsedSeconds / 60)}:${(elapsedSeconds % 60).toString().padStart(2, "0")}`;
    const eta = isWaitingForStream
        ? "Estimating..."
        : etaSeconds > 0
            ? `${Math.floor(etaSeconds / 60)}:${(etaSeconds % 60).toString().padStart(2, "0")}`
            : "<0:05";

    return (
        <GlassCard className="border border-yellow-500/20 bg-yellow-500/5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-[10px] text-yellow-300 uppercase tracking-[0.24em]">Analysis Running</p>
                    <p className="text-lg font-semibold text-white mt-1">{stageLabel}</p>
                    <p className="text-xs text-slate-400 mt-1">{latestMessage}</p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em]">ETA</p>
                    <p className="text-sm font-mono text-yellow-300">{eta}</p>
                </div>
            </div>

            <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{isWaitingForStream ? "Waiting for backend stream..." : `${Math.round(progressPct)}% complete`}</span>
                    <span>{hasReliableHistory ? `Elapsed ${elapsed}` : `Elapsed ${elapsed} · learning timing`}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <motion.div
                        className="h-full bg-gradient-to-r from-yellow-400 to-emerald-400"
                        initial={{ width: "0%" }}
                        animate={{ width: `${isWaitingForStream ? 0 : clamp(progressPct, 0, 100)}%` }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                </div>
            </div>
        </GlassCard>
    );
}

function signalColor(signal: string | undefined) {
    if (signal === "LONG") return "text-emerald-400";
    if (signal === "SHORT") return "text-red-400";
    return "text-slate-400";
}

function signalBadge(signal: string | undefined) {
    if (signal === "LONG") return "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
    if (signal === "SHORT") return "bg-red-500/10 border-red-500/30 text-red-300";
    return "bg-slate-800/60 border-slate-700 text-slate-400";
}

function PullHistoryCard({ snapshots, currentRequestId }: { snapshots: AnalysisSnapshotItem[]; currentRequestId?: string }) {
    const { timeZone } = useTimezone();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const sorted = [...snapshots].sort((a, b) => {
        const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return bt - at;
    });

    if (sorted.length === 0) return (
        <GlassCard className="text-center py-8">
            <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">No history yet</p>
            <p className="text-slate-400 text-sm">Run an analysis to start building your pull history.</p>
        </GlassCard>
    );

    function recsByUnderlying(recs: SnapshotRecommendation[] | undefined) {
        const map: Record<string, SnapshotRecommendation> = {};
        for (const r of recs ?? []) {
            const key = r.underlying_symbol || r.symbol;
            map[key] = r;
        }
        return map;
    }

    useEffect(() => {
        if (expandedId) return;
        if (currentRequestId && sorted.some((snap) => snap.request_id === currentRequestId)) {
            setExpandedId(currentRequestId);
            return;
        }
        if (sorted[0]?.request_id) {
            setExpandedId(sorted[0].request_id);
        }
    }, [currentRequestId, expandedId, sorted]);

    return (
        <GlassCard>
            <div className="flex items-center justify-between mb-4">
                <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-[0.24em]">Recommendation History</p>
                    <h2 className="text-base font-semibold text-white mt-1">Pull-to-Pull Signal Changes</h2>
                </div>
                <span className="text-xs text-slate-500">{sorted.length} runs</span>
            </div>
            {sorted.length === 1 && (
                <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 px-4 py-3 mb-3 text-xs text-slate-500">
                    This is the first recorded run. History will build up as more pulls complete — differences will be highlighted automatically.
                </div>
            )}
            <div className="space-y-2">
                {sorted.map((snap, i) => {
                    const prev = sorted[i + 1];
                    const isCurrent = snap.request_id === currentRequestId;
                    const isExpanded = expandedId === snap.request_id;
                    const prevRecMap = prev ? recsByUnderlying(prev.recommendations) : null;
                    const thisRecMap = recsByUnderlying(snap.recommendations);
                    const allUnderlying = Array.from(new Set([
                        ...Object.keys(thisRecMap),
                        ...(prevRecMap ? Object.keys(prevRecMap) : []),
                    ]));

                    const hasDiff = prevRecMap !== null && allUnderlying.some((u) => {
                        const a = thisRecMap[u];
                        const b = prevRecMap[u];
                        return !a || !b || a.symbol !== b.symbol || a.action !== b.action || a.leverage !== b.leverage;
                    });

                    return (
                        <div
                            key={snap.request_id}
                            className={`rounded-xl border ${isCurrent ? "border-blue-500/30 bg-blue-500/5" : "border-slate-700/50 bg-slate-900/40"}`}
                        >
                            {/* ── Collapsed summary row — always visible, click to expand ── */}
                            <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : snap.request_id)}
                                className="w-full text-left px-3 py-3"
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${signalBadge(snap.signal_type)}`}>
                                        {snap.signal_type ?? "HOLD"}
                                    </span>
                                    {isCurrent && (
                                        <span className="text-[10px] font-semibold text-blue-300 uppercase tracking-wider px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10">
                                            Current
                                        </span>
                                    )}
                                    {hasDiff && (
                                        <span className="text-[10px] font-semibold text-amber-300 uppercase tracking-wider px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10">
                                            Changed
                                        </span>
                                    )}
                                    <span className="text-xs text-slate-500 ml-auto font-mono">
                                        {formatTs(snap.timestamp, timeZone)}
                                    </span>
                                    <span className="text-slate-600">
                                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {snap.model_name && (
                                        <span className="text-[10px] text-slate-500 font-mono">{snap.model_name}</span>
                                    )}
                                    <span className="text-[10px] text-slate-600">·</span>
                                    <span className="text-[10px] text-slate-500">{snap.snapshot_article_count} articles</span>
                                    {allUnderlying.length > 0 && !isExpanded && (
                                        <>
                                            <span className="text-[10px] text-slate-600">·</span>
                                            <span className="text-[10px] text-slate-500">{allUnderlying.join(", ")}</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {(snap.recommendations ?? []).length > 0 ? (
                                        (snap.recommendations ?? []).map((rec, idx) => {
                                            const underlying = rec.underlying_symbol || rec.symbol;
                                            const tone = rec.action === "BUY"
                                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                                : "border-red-500/30 bg-red-500/10 text-red-200";
                                            return (
                                                <span
                                                    key={`${snap.request_id}-${underlying}-${rec.symbol}-${idx}`}
                                                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono ${tone}`}
                                                >
                                                    {underlying}: {rec.action} {rec.symbol} {rec.leverage}
                                                </span>
                                            );
                                        })
                                    ) : (
                                        <span className="text-[11px] text-slate-600 italic">No saved ticker recommendations for this run.</span>
                                    )}
                                </div>
                            </button>

                            {/* ── Expanded per-symbol details ── */}
                            {isExpanded && allUnderlying.length > 0 && (
                                <div className="px-3 pb-3 border-t border-slate-700/40 pt-3">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-2">Ticker Details</p>
                                    <div className="flex flex-wrap gap-2">
                                        {allUnderlying.map((underlying) => {
                                            const cur = thisRecMap[underlying];
                                            const prv = prevRecMap ? prevRecMap[underlying] : null;
                                            const changed = prv && cur && (cur.symbol !== prv.symbol || cur.action !== prv.action || cur.leverage !== prv.leverage);
                                            const added = cur && !prv && prevRecMap;
                                            const removed = !cur && prv;
                                            const borderCls = changed
                                                ? "border-amber-500/40 bg-amber-500/5"
                                                : added
                                                    ? "border-emerald-500/40 bg-emerald-500/5"
                                                    : removed
                                                        ? "border-red-500/40 bg-red-500/10 opacity-60"
                                                        : "border-slate-700/50 bg-slate-950/40";

                                            return (
                                                <div key={underlying} className={`rounded-lg border px-2.5 py-1.5 min-w-[90px] ${borderCls}`}>
                                                    <p className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">{underlying}</p>
                                                    {cur ? (
                                                        <p className={`text-xs font-bold font-mono ${signalColor(snap.signal_type)}`}>
                                                            {cur.action} {cur.symbol} <span className="font-normal text-slate-500">{cur.leverage}</span>
                                                        </p>
                                                    ) : (
                                                        <p className="text-xs text-slate-600 italic">removed</p>
                                                    )}
                                                    {changed && prv && (
                                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5 line-through">
                                                            {prv.action} {prv.symbol} {prv.leverage}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {isExpanded && allUnderlying.length === 0 && (
                                <div className="px-3 pb-3 border-t border-slate-700/40 pt-3">
                                    <p className="text-xs text-slate-600 italic">This run does not have persisted ticker-level recommendation details.</p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </GlassCard>
    );
}

function ComparisonResultsCard({
    title,
    baselineResult,
    comparisonResult,
    baselineLabel,
    comparisonLabel,
}: {
    title: string;
    baselineResult: AnalysisResult | null;
    comparisonResult: AnalysisResult | null;
    baselineLabel: string;
    comparisonLabel: string;
}) {
    if (!baselineResult || !comparisonResult) return null;

    const curRecs: Recommendation[] = baselineResult.trading_signal?.recommendations ?? [];
    const cmpRecs: Recommendation[] = comparisonResult.trading_signal?.recommendations ?? [];
    const curSentiment = baselineResult.sentiment_scores ?? {};
    const cmpSentiment = comparisonResult.sentiment_scores ?? {};
    const curMap: Record<string, Recommendation> = {};
    const cmpMap: Record<string, Recommendation> = {};
    for (const r of curRecs) curMap[r.underlying_symbol || r.symbol] = r;
    for (const r of cmpRecs) cmpMap[r.underlying_symbol || r.symbol] = r;
    const allUnderlying = Array.from(new Set([...Object.keys(curMap), ...Object.keys(cmpMap)]));
    const curSignal = baselineResult.trading_signal?.signal_type || "n/a";
    const cmpSignal = comparisonResult.trading_signal?.signal_type || "n/a";
    const signalMatch = curSignal === cmpSignal;
    const changedSymbols = allUnderlying.filter((underlying) => {
        const cur = curMap[underlying];
        const cmp = cmpMap[underlying];
        return !cur || !cmp || cur.symbol !== cmp.symbol || cur.action !== cmp.action || cur.leverage !== cmp.leverage;
    });

    return (
        <GlassCard>
            <p className="text-[10px] text-slate-500 uppercase tracking-[0.24em] mb-2">{title}</p>
            <StageMetricsComparison baseline={baselineResult} comparison={comparisonResult} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline signal</p>
                    <p className={`text-sm font-bold mt-1 ${signalColor(curSignal)}`}>{curSignal}</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">{baselineLabel}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{(baselineResult.processing_time_ms / 1000).toFixed(2)}s</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison signal</p>
                    <p className={`text-sm font-bold mt-1 ${signalColor(cmpSignal)}`}>{cmpSignal}</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">{comparisonLabel}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{(comparisonResult.processing_time_ms / 1000).toFixed(2)}s</p>
                </div>
                <div className={`rounded-lg border p-3 col-span-2 ${signalMatch ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Agreement</p>
                    <p className={`text-sm font-semibold mt-1 ${signalMatch ? "text-emerald-400" : "text-amber-400"}`}>
                        {signalMatch ? "Runs agree on overall signal" : "Runs diverge — something materially changed"}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                        {changedSymbols.length > 0
                            ? `${changedSymbols.length} symbol${changedSymbols.length === 1 ? "" : "s"} changed recommendation.`
                            : "Ticker-level recommendations stayed the same."}
                    </p>
                </div>
            </div>
            {allUnderlying.length > 0 && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-3 py-3 border-b border-slate-700/50 bg-slate-900/20">
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline run</p>
                            <p className="text-xs text-slate-200 font-mono mt-1 break-all">{baselineLabel}</p>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison run</p>
                            <p className="text-xs text-slate-200 font-mono mt-1 break-all">{comparisonLabel}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2 border-b border-slate-700/50 bg-slate-900/40">
                        <span>Symbol</span>
                        <span>Baseline ticker</span>
                        <span>Comparison ticker</span>
                        <span>Match</span>
                    </div>
                    {allUnderlying.map((underlying) => {
                        const cur = curMap[underlying];
                        const cmp = cmpMap[underlying];
                        const same = !!(cur && cmp && cur.symbol === cmp.symbol && cur.action === cmp.action && cur.leverage === cmp.leverage);
                        const onlyInBaseline = !!(cur && !cmp);
                        const onlyInComparison = !!(!cur && cmp);
                        const sameDirection = !!(cur && cmp && cur.action === cmp.action && (cur.thesis ?? "") === (cmp.thesis ?? ""));
                        const leverageDrift = !same && sameDirection && !onlyInBaseline && !onlyInComparison;
                        const matchLabel = same ? "Same" : leverageDrift ? "Leverage diff" : "Different";
                        const matchCls = same ? "text-emerald-400" : leverageDrift ? "text-blue-400" : "text-amber-400";
                        const differenceHint = onlyInBaseline
                            ? "Only the baseline run recommended a trade for this symbol."
                            : onlyInComparison
                                ? "Only the comparison run recommended a trade for this symbol."
                                : same
                                    ? "Both runs chose the same execution ticker, action, and leverage."
                                    : leverageDrift
                                        ? "Both runs agree on direction but landed on different leverage tiers."
                                        : "The trade thesis changed enough to alter ticker, action, or direction.";
                        const curWhy = compactReasoning(curSentiment[underlying]?.reasoning);
                        const cmpWhy = compactReasoning(cmpSentiment[underlying]?.reasoning);
                        const drivers = buildChangeDrivers(
                            underlying,
                            cur,
                            cmp,
                            curSentiment[underlying],
                            cmpSentiment[underlying],
                        );
                        return (
                            <div key={underlying} className={`border-b border-slate-800/60 last:border-0 ${!same ? "bg-amber-500/5" : ""}`}>
                                <div className="grid grid-cols-4 px-3 py-2.5 items-center">
                                    <span className="text-xs font-bold text-slate-300 font-mono">{underlying}</span>
                                    <span className="text-xs font-mono text-slate-200">
                                        {cur ? <>{cur.action} <span className="font-bold">{cur.symbol}</span> <span className="text-slate-500">{cur.leverage}</span></> : <span className="text-slate-600 italic">—</span>}
                                    </span>
                                    <span className="text-xs font-mono text-slate-200">
                                        {cmp ? <>{cmp.action} <span className="font-bold">{cmp.symbol}</span> <span className="text-slate-500">{cmp.leverage}</span></> : <span className="text-slate-600 italic">—</span>}
                                    </span>
                                    <span className={`text-[10px] font-semibold uppercase ${matchCls}`}>{matchLabel}</span>
                                </div>
                                <div className="px-3 pb-3">
                                    <p className="text-[10px] text-slate-500 leading-relaxed">{differenceHint}</p>
                                    {!same && drivers.length > 0 && (
                                        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-amber-300">Why It Changed</p>
                                            <div className="mt-1.5 space-y-1">
                                                {drivers.map((driver) => (
                                                    <p key={`${underlying}-${driver}`} className="text-xs text-slate-200 leading-relaxed">
                                                        {driver}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-2">
                                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline Why</p>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{curWhy}</p>
                                        </div>
                                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison Why</p>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{cmpWhy}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </GlassCard>
    );
}

function ModelComparePanel({
    result,
    snapshots,
    availableModels,
    compareBaselineResult,
    compareResult,
    goldenDatasetRequestId,
    goldenBaselineResult,
    benchmarkResults,
    savedBaselineResult,
    savedComparisonResult,
    onRerunSnapshot,
    onCompareSavedRuns,
    onSelectGoldenDataset,
    onClearBenchmarks,
    rerunLoading,
    rerunError,
    savedCompareLoading,
    savedCompareError,
}: {
    result: AnalysisResult | null;
    snapshots: AnalysisSnapshotItem[];
    availableModels: string[];
    compareBaselineResult: AnalysisResult | null;
    compareResult: AnalysisResult | null;
    goldenDatasetRequestId: string;
    goldenBaselineResult: AnalysisResult | null;
    benchmarkResults: AnalysisResult[];
    savedBaselineResult: AnalysisResult | null;
    savedComparisonResult: AnalysisResult | null;
    onRerunSnapshot: (requestId: string, modelName: string, extractionModel?: string, reasoningModel?: string) => Promise<void>;
    onCompareSavedRuns: (baselineRequestId: string, comparisonRequestId: string) => Promise<void>;
    onSelectGoldenDataset: (requestId: string) => void;
    onClearBenchmarks: () => void;
    rerunLoading: boolean;
    rerunError: string | null;
    savedCompareLoading: boolean;
    savedCompareError: string | null;
}) {
    const [selectedSnapshotId, setSelectedSnapshotId] = useState(goldenDatasetRequestId || result?.request_id || snapshots[0]?.request_id || "");
    const [selectedExtractionModel, setSelectedExtractionModel] = useState("");
    const [selectedReasoningModel, setSelectedReasoningModel] = useState("");
    const [savedBaselineId, setSavedBaselineId] = useState(result?.request_id || snapshots[0]?.request_id || "");
    const [savedComparisonId, setSavedComparisonId] = useState(snapshots[1]?.request_id || snapshots[0]?.request_id || "");
    const { timeZone } = useTimezone();

    useEffect(() => {
        if (!goldenDatasetRequestId && result?.request_id) setSelectedSnapshotId(result.request_id);
    }, [goldenDatasetRequestId, result?.request_id]);
    useEffect(() => {
        if (goldenDatasetRequestId) setSelectedSnapshotId(goldenDatasetRequestId);
    }, [goldenDatasetRequestId]);
    useEffect(() => {
        if (!selectedSnapshotId && snapshots.length > 0) setSelectedSnapshotId(snapshots[0].request_id);
    }, [snapshots, selectedSnapshotId]);
    useEffect(() => {
        if (result?.request_id && !savedBaselineId) setSavedBaselineId(result.request_id);
    }, [result?.request_id, savedBaselineId]);
    useEffect(() => {
        if (!savedBaselineId && snapshots.length > 0) setSavedBaselineId(snapshots[0].request_id);
    }, [savedBaselineId, snapshots]);
    useEffect(() => {
        if (!savedComparisonId && snapshots.length > 1) setSavedComparisonId(snapshots[1].request_id);
    }, [savedComparisonId, snapshots]);

    const selectedSnapshot = snapshots.find((s) => s.request_id === selectedSnapshotId);
    const selectedSavedBaseline = snapshots.find((s) => s.request_id === savedBaselineId);
    const selectedSavedComparison = snapshots.find((s) => s.request_id === savedComparisonId);
    const isGoldenDataset = !!selectedSnapshot && selectedSnapshot.request_id === goldenDatasetRequestId;
    const baselineModelLabel = selectedSnapshot
        ? (selectedSnapshot.extraction_model && selectedSnapshot.reasoning_model
            ? `${selectedSnapshot.extraction_model} → ${selectedSnapshot.reasoning_model}`
            : selectedSnapshot.extraction_model || selectedSnapshot.model_name || "Baseline model")
        : "Baseline model";
    const twoStageComparison = !!(selectedExtractionModel && selectedReasoningModel);
    const canRunComparison = !!(selectedSnapshotId && (selectedExtractionModel || selectedReasoningModel));
    const canCompareSavedRuns = !!(savedBaselineId && savedComparisonId && savedBaselineId !== savedComparisonId);
    const comparisonModelLabel = twoStageComparison
        ? `${selectedExtractionModel} → ${selectedReasoningModel}`
        : selectedExtractionModel || selectedReasoningModel || "Comparison model";

    const handleRunOriginal = () => {
        if (!selectedSnapshot || !selectedSnapshotId) return;
        const em = selectedSnapshot.extraction_model?.trim() || "";
        const rm = selectedSnapshot.reasoning_model?.trim() || "";
        const mm = selectedSnapshot.model_name?.trim() || "";
        void onRerunSnapshot(selectedSnapshotId, twoStageComparison ? "" : mm, em || undefined, rm || undefined);
    };

    if (!result && snapshots.filter((s) => s.snapshot_available).length === 0) return (
        <GlassCard className="text-center py-8">
            <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">No snapshots yet</p>
            <p className="text-slate-400 text-sm">Run an analysis to create a replayable snapshot for model comparison.</p>
        </GlassCard>
    );

    return (
        <div className="space-y-4">
            <GlassCard>
                <div className="mb-4">
                    <p className="text-[10px] text-amber-300 uppercase tracking-[0.24em]">Run Comparison</p>
                    <h2 className="text-lg font-semibold text-white mt-1">Compare Two Saved Runs</h2>
                    <p className="text-sm text-slate-400 mt-1">
                        Load any two saved pulls and inspect why the recommendation changed over time.
                    </p>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <label className="block">
                        <span className="text-[11px] text-slate-400">Earlier / baseline run</span>
                        <select
                            value={savedBaselineId}
                            onChange={(e) => setSavedBaselineId(e.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                        >
                            {snapshots.filter((s) => s.snapshot_available).map((s) => (
                                <option key={`baseline-${s.request_id}`} value={s.request_id}>
                                    {formatSnapshotLabel(s, timeZone)} · {s.snapshot_article_count} articles
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-[11px] text-slate-400">Later / comparison run</span>
                        <select
                            value={savedComparisonId}
                            onChange={(e) => setSavedComparisonId(e.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                        >
                            {snapshots.filter((s) => s.snapshot_available).map((s) => (
                                <option key={`comparison-${s.request_id}`} value={s.request_id}>
                                    {formatSnapshotLabel(s, timeZone)} · {s.snapshot_article_count} articles
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="flex items-center justify-between gap-3 mt-3">
                    <div className="text-xs text-slate-500 break-words leading-relaxed">
                        {selectedSavedBaseline && (
                            <span>{formatSnapshotLabel(selectedSavedBaseline, timeZone)} </span>
                        )}
                        {selectedSavedComparison && (
                            <span>vs {formatSnapshotLabel(selectedSavedComparison, timeZone)}</span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => void onCompareSavedRuns(savedBaselineId, savedComparisonId)}
                        disabled={savedCompareLoading || !canCompareSavedRuns}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 min-h-[42px] whitespace-nowrap ml-auto"
                    >
                        {savedCompareLoading ? "Loading..." : "Compare Runs"}
                    </button>
                </div>
                {savedCompareError && <p className="text-sm text-red-300 mt-3">{savedCompareError}</p>}
                {!canCompareSavedRuns && (
                    <p className="text-xs text-slate-500 mt-3">Choose two different saved runs to compare.</p>
                )}
            </GlassCard>

            <GlassCard>
                <div className="mb-4">
                    <p className="text-[10px] text-blue-300 uppercase tracking-[0.24em]">Model Comparison</p>
                    <h2 className="text-lg font-semibold text-white mt-1">Replay Frozen Dataset</h2>
                    <p className="text-sm text-slate-400 mt-1">
                        Run a saved snapshot through a different model — no re-download of articles or prices.
                    </p>
                </div>
                <div className="space-y-3 mb-3">
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 items-end">
                        <label className="block">
                            <span className="text-[11px] text-slate-400">Saved snapshot</span>
                            <select
                                value={selectedSnapshotId}
                                onChange={(e) => setSelectedSnapshotId(e.target.value)}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            >
                                {result && (
                                    <option value={result.request_id}>Current run · {result.request_id}</option>
                                )}
                                {snapshots
                                    .filter((s) => s.request_id !== result?.request_id && s.snapshot_available)
                                    .map((s) => (
                                        <option key={s.request_id} value={s.request_id}>
                                            {formatSnapshotLabel(s, timeZone)} · {s.snapshot_article_count} articles
                                        </option>
                                    ))}
                            </select>
                        </label>
                        {selectedSnapshot && (selectedSnapshot.extraction_model || selectedSnapshot.reasoning_model || selectedSnapshot.model_name) && (
                            <button
                                type="button"
                                onClick={handleRunOriginal}
                                disabled={rerunLoading}
                                className="rounded-lg border border-slate-600 px-4 py-2 text-xs text-slate-300 hover:text-white hover:border-slate-400 disabled:opacity-50 min-h-[42px] whitespace-nowrap"
                                title="Re-run this snapshot with the same model(s) it was originally run with"
                            >
                                Rerun original
                            </button>
                        )}
                        {selectedSnapshot && (
                            <button
                                type="button"
                                onClick={() => onSelectGoldenDataset(selectedSnapshot.request_id)}
                                className={`rounded-lg border px-4 py-2 text-xs min-h-[42px] whitespace-nowrap ${isGoldenDataset ? "border-amber-400 text-amber-200 bg-amber-500/10" : "border-slate-600 text-slate-300 hover:text-white hover:border-slate-400"}`}
                            >
                                {isGoldenDataset ? "Golden dataset" : "Set as golden dataset"}
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <label className="block">
                            <span className="text-[11px] text-slate-400">Stage 1 model <span className="text-slate-600">(or single model)</span></span>
                            <select
                                value={selectedExtractionModel}
                                onChange={(e) => setSelectedExtractionModel(e.target.value)}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            >
                                <option value="">— choose a model —</option>
                                {availableModels.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-[11px] text-slate-400">Stage 2 model <span className="text-slate-600">(optional — two-stage)</span></span>
                            <select
                                value={selectedReasoningModel}
                                onChange={(e) => setSelectedReasoningModel(e.target.value)}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            >
                                <option value="">— same as Stage 1 —</option>
                                {availableModels.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        {selectedSnapshot && (
                            <p className="text-xs text-slate-500 break-words leading-relaxed">
                                {formatSnapshotLabel(selectedSnapshot, timeZone)} · {selectedSnapshot.snapshot_article_count} articles · {selectedSnapshot.symbols.join(", ")}
                                {selectedSnapshot.risk_profile && (
                                    <span className="ml-1.5 text-[10px] font-mono text-slate-600">· {selectedSnapshot.risk_profile}</span>
                                )}
                                {isGoldenDataset && (
                                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">· golden dataset</span>
                                )}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={() => void onRerunSnapshot(
                                selectedSnapshotId,
                                twoStageComparison ? "" : selectedExtractionModel,
                                selectedExtractionModel || undefined,
                                selectedReasoningModel || undefined,
                            )}
                            disabled={rerunLoading || !canRunComparison}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 min-h-[42px] whitespace-nowrap ml-auto"
                        >
                            {rerunLoading ? "Running..." : "Run Comparison"}
                        </button>
                    </div>
                </div>
                {rerunError && <p className="text-sm text-red-300 mt-3">{rerunError}</p>}
            </GlassCard>

            {benchmarkResults.length > 0 && (
                <GlassCard>
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <p className="text-[10px] text-emerald-300 uppercase tracking-[0.24em]">Benchmark</p>
                            <h2 className="text-lg font-semibold text-white mt-1">Golden Dataset Benchmarks</h2>
                            <p className="text-sm text-slate-400 mt-1">
                                Repeated reruns against the same frozen dataset, with timing and final recommendations preserved.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClearBenchmarks}
                            className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:text-white hover:border-slate-400"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="space-y-3">
                        {benchmarkResults.map((benchmark) => (
                            <div key={benchmark.request_id} className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold text-white">{benchmark.trading_signal?.signal_type || "HOLD"}</p>
                                        <p className="text-[10px] text-slate-500 font-mono break-all">{benchmark.request_id}</p>
                                    </div>
                                    <p className="text-sm text-slate-300">{(benchmark.processing_time_ms / 1000).toFixed(2)}s</p>
                                </div>
                                <StageMetricsComparison baseline={goldenBaselineResult} comparison={benchmark} />
                                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {((benchmark.trading_signal?.recommendations || []) as Recommendation[]).map((rec) => (
                                        <div key={`${benchmark.request_id}-${rec.underlying_symbol || rec.symbol}`} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                                            <p className="text-xs font-mono text-slate-200">
                                                {rec.underlying_symbol || rec.symbol}: {rec.action} {rec.symbol} {rec.leverage}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </GlassCard>
            )}

            <ComparisonResultsCard
                title="Saved Run Results"
                baselineResult={savedBaselineResult}
                comparisonResult={savedComparisonResult}
                baselineLabel={selectedSavedBaseline ? formatSnapshotLabel(selectedSavedBaseline, timeZone) : "Baseline run"}
                comparisonLabel={selectedSavedComparison ? formatSnapshotLabel(selectedSavedComparison, timeZone) : "Comparison run"}
            />

            {compareResult && (() => {
                const baselineForCompare = compareBaselineResult || result;
                const curRecs: Recommendation[] = baselineForCompare?.trading_signal?.recommendations ?? [];
                const cmpRecs: Recommendation[] = compareResult.trading_signal?.recommendations ?? [];
                const curSentiment = baselineForCompare?.sentiment_scores ?? {};
                const cmpSentiment = compareResult.sentiment_scores ?? {};
                const curMap: Record<string, Recommendation> = {};
                const cmpMap: Record<string, Recommendation> = {};
                for (const r of curRecs) curMap[r.underlying_symbol || r.symbol] = r;
                for (const r of cmpRecs) cmpMap[r.underlying_symbol || r.symbol] = r;
                const allUnderlying = Array.from(new Set([...Object.keys(curMap), ...Object.keys(cmpMap)]));
                const curSignal = baselineForCompare?.trading_signal?.signal_type || "n/a";
                const cmpSignal = compareResult.trading_signal?.signal_type || "n/a";
                const signalMatch = curSignal === cmpSignal;
                return (
                    <GlassCard>
                        <p className="text-[10px] text-slate-500 uppercase tracking-[0.24em] mb-4">Results</p>
                        <StageMetricsComparison baseline={baselineForCompare} comparison={compareResult} />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline signal</p>
                                <p className={`text-sm font-bold mt-1 ${signalColor(curSignal)}`}>{curSignal}</p>
                                <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">{baselineModelLabel}</p>
                                <p className="text-[10px] text-slate-600 mt-1">{baselineForCompare ? `${(baselineForCompare.processing_time_ms / 1000).toFixed(2)}s` : "—"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison signal</p>
                                <p className={`text-sm font-bold mt-1 ${signalColor(cmpSignal)}`}>{cmpSignal}</p>
                                <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">{comparisonModelLabel}</p>
                                <p className="text-[10px] text-slate-600 mt-1">{(compareResult.processing_time_ms / 1000).toFixed(2)}s</p>
                            </div>
                            <div className={`rounded-lg border p-3 col-span-2 ${signalMatch ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Agreement</p>
                                <p className={`text-sm font-semibold mt-1 ${signalMatch ? "text-emerald-400" : "text-amber-400"}`}>
                                    {signalMatch ? "Models agree on overall signal" : "Models diverge — same data, different reads"}
                                </p>
                            </div>
                        </div>
                        {allUnderlying.length > 0 && (
                            <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 overflow-hidden">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-3 py-3 border-b border-slate-700/50 bg-slate-900/20">
                                    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline model</p>
                                        <p className="text-xs text-slate-200 font-mono mt-1 break-all">{baselineModelLabel}</p>
                                    </div>
                                    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison model</p>
                                        <p className="text-xs text-slate-200 font-mono mt-1 break-all">{comparisonModelLabel}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2 border-b border-slate-700/50 bg-slate-900/40">
                                    <span>Symbol</span>
                                    <span>Baseline ticker</span>
                                    <span>Comparison ticker</span>
                                    <span>Match</span>
                                </div>
                                {allUnderlying.map((underlying) => {
                                    const cur = curMap[underlying];
                                    const cmp = cmpMap[underlying];
                                    const same = !!(cur && cmp && cur.symbol === cmp.symbol && cur.action === cmp.action && cur.leverage === cmp.leverage);
                                    const onlyInBaseline = !!(cur && !cmp);
                                    const onlyInComparison = !!(!cur && cmp);
                                    // Detect same directional thesis but different leverage tier (threshold artifact)
                                    const sameDirection = !!(cur && cmp && cur.action === cmp.action && (cur.thesis ?? "") === (cmp.thesis ?? ""));
                                    const leverageDrift = !same && sameDirection && !onlyInBaseline && !onlyInComparison;
                                    const matchLabel = same ? "Same" : leverageDrift ? "Leverage diff" : "Different";
                                    const matchCls = same ? "text-emerald-400" : leverageDrift ? "text-blue-400" : "text-amber-400";
                                    const differenceHint = onlyInBaseline
                                        ? "Only the baseline model recommended a trade for this symbol."
                                        : onlyInComparison
                                            ? "Only the comparison model recommended a trade for this symbol."
                                            : same
                                                ? "Both models chose the same execution ticker, action, and leverage."
                                                : leverageDrift
                                                    ? "Both models agree on direction but landed on different leverage tiers — likely a confidence-threshold artifact (e.g. 0.78 vs 0.72 straddles the 0.75 cutoff). The directional thesis is the same."
                                                    : "Both models placed a trade, but they disagreed on execution ticker, action, or direction.";
                                    const curWhy = compactReasoning(curSentiment[underlying]?.reasoning);
                                    const cmpWhy = compactReasoning(cmpSentiment[underlying]?.reasoning);
                                    return (
                                        <div key={underlying} className={`border-b border-slate-800/60 last:border-0 ${!same ? "bg-amber-500/5" : ""}`}>
                                            <div className="grid grid-cols-4 px-3 py-2.5 items-center">
                                                <span className="text-xs font-bold text-slate-300 font-mono">{underlying}</span>
                                                <span className="text-xs font-mono text-slate-200">
                                                    {cur ? <>{cur.action} <span className="font-bold">{cur.symbol}</span> <span className="text-slate-500">{cur.leverage}</span></> : <span className="text-slate-600 italic">—</span>}
                                                </span>
                                                <span className="text-xs font-mono text-slate-200">
                                                    {cmp ? <>{cmp.action} <span className="font-bold">{cmp.symbol}</span> <span className="text-slate-500">{cmp.leverage}</span></> : <span className="text-slate-600 italic">—</span>}
                                                </span>
                                                <span className={`text-[10px] font-semibold uppercase ${matchCls}`}>{matchLabel}</span>
                                            </div>
                                            <div className="px-3 pb-3">
                                                <p className="text-[10px] text-slate-500 leading-relaxed">{differenceHint}</p>
                                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-2">
                                                    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline Why</p>
                                                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">{curWhy}</p>
                                                    </div>
                                                    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison Why</p>
                                                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">{cmpWhy}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </GlassCard>
                );
            })()}
        </div>
    );
}

function DebugPanel({ result }: { result: AnalysisResult }) {
    const { timeZone } = useTimezone();
    const modelInputs = result.model_inputs;
    const ingestionTrace = result.ingestion_trace;
    const redTeamDebug = result.red_team_debug;
    const blueTeamSignal = result.blue_team_signal;
    const consensusSignal = result.trading_signal;
    const validationEntries = Object.entries(result.market_validation ?? {});
    const visibleArticles = modelInputs?.articles ?? [];
    const webContextEntries = Object.entries(modelInputs?.web_context_by_symbol ?? {});
    const webItemEntries = Object.entries(modelInputs?.web_items_by_symbol ?? {});
    const queueArticles = ingestionTrace?.queue?.selected_articles ?? [];
    const queueUrls = ingestionTrace?.queue?.selected_urls ?? [];
    return (
        <GlassCard>
            <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                    <p className="text-[10px] text-blue-300 uppercase tracking-[0.24em]">Debug</p>
                    <h2 className="text-lg font-semibold text-white mt-1">Model Input View</h2>
                </div>
                <div className="text-right text-xs text-slate-400">
                    <p>{visibleArticles.length} articles</p>
                    <p>{validationEntries.length} validation blocks</p>
                </div>
            </div>
            <div className="space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Structured Validation Summary</p>
                        <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                            {modelInputs?.validation_context || "No validation context returned."}
                        </pre>
                    </div>
                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Price Context</p>
                        {modelInputs && Object.keys(modelInputs.price_context ?? {}).length > 0 ? (
                            <div className="space-y-2">
                                {Object.entries(modelInputs.price_context).map(([key, value]) => (
                                    <div key={key} className="flex items-center justify-between text-xs border-b border-slate-800 pb-2 last:border-0">
                                        <span className="text-slate-400 font-mono">{key}</span>
                                        <span className="text-white font-mono">{Number(value).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500">No price context captured.</p>
                        )}
                    </div>
                </div>
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Compiled News Context</p>
                    <pre className="max-h-80 overflow-auto text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                        {modelInputs?.news_context || "No compiled news context returned."}
                    </pre>
                </div>
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Queued Article Intake</p>
                    {ingestionTrace ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Source</p>
                                    <p className="mt-1 text-sm font-semibold text-white">{ingestionTrace.source || "unknown"}</p>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Trigger</p>
                                    <p className="mt-1 text-sm font-semibold text-white">{ingestionTrace.trigger_source || "api"}</p>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Pending Queue</p>
                                    <p className="mt-1 text-sm font-semibold text-white">{ingestionTrace.queue?.pending_count ?? 0}</p>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Selected</p>
                                    <p className="mt-1 text-sm font-semibold text-white">{ingestionTrace.queue?.selected_count ?? ingestionTrace.total_items ?? 0}</p>
                                </div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="text-slate-500">Article IDs</span>
                                    {(ingestionTrace.selected_article_ids ?? []).length > 0 ? (
                                        ingestionTrace.selected_article_ids.map((articleId) => (
                                            <span key={`selected-${articleId}`} className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-blue-200">
                                                #{articleId}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-slate-500">No queued article IDs captured.</span>
                                    )}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                    <span className="text-slate-500">Fast Lane</span>
                                    {(ingestionTrace.selected_fast_lane_article_ids ?? []).length > 0 ? (
                                        ingestionTrace.selected_fast_lane_article_ids.map((articleId) => (
                                            <span key={`fast-lane-${articleId}`} className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                                                #{articleId}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-slate-500">None in this run.</span>
                                    )}
                                </div>
                            </div>
                            <div className="max-h-80 overflow-auto space-y-3">
                                {queueArticles.length > 0 ? queueArticles.map((article, index) => (
                                    <details key={`${article.source}-${article.title}-${index}`} className="group rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                        <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-emerald-300">{article.source}</p>
                                                <p className="text-sm text-white mt-1">{article.title}</p>
                                                {article.summary && <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">{article.summary}</p>}
                                            </div>
                                            <span className="text-[10px] uppercase tracking-wider text-slate-500">
                                                {ingestionTrace.selected_article_ids?.[index] ? `#${ingestionTrace.selected_article_ids[index]}` : `item ${index + 1}`}
                                            </span>
                                        </summary>
                                        <div className="mt-3 border-t border-slate-800 pt-3">
                                            {article.summary && <p className="text-xs text-slate-400 leading-relaxed">{article.summary}</p>}
                                            {article.keywords.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                    {article.keywords.map((keyword, keywordIndex) => (
                                                        <span key={`${article.title}-${keyword}-${keywordIndex}`} className="text-[10px] rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                                                            #{keyword}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {(article.content || "").trim() && (
                                                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300 font-mono leading-relaxed">
                                                    {article.content}
                                                </pre>
                                            )}
                                            {queueUrls[index] && (
                                                <p className="mt-2 break-all text-[10px] text-slate-500 font-mono">{queueUrls[index]}</p>
                                            )}
                                        </div>
                                    </details>
                                )) : (
                                    <p className="text-xs text-slate-500">No queue trace was captured for this run.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-xs text-slate-500">No ingestion trace returned for this run.</p>
                    )}
                </div>
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">RSS Articles Fed To The Model</p>
                    <div className="max-h-80 overflow-auto space-y-3">
                        {visibleArticles.length > 0 ? visibleArticles.map((article, index) => (
                            <details key={`${article.source}-${article.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                <summary className="cursor-pointer list-none">
                                    <p className="text-[10px] uppercase tracking-wider text-blue-300">{article.source}</p>
                                    <p className="text-sm text-white mt-1">{article.title}</p>
                                    {article.description && <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">{article.description}</p>}
                                </summary>
                                <div className="mt-3 border-t border-slate-800 pt-3">
                                    {article.description && <p className="text-xs text-slate-400 leading-relaxed">{article.description}</p>}
                                    {article.keywords.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {article.keywords.map((keyword, keywordIndex) => (
                                                <span key={`${article.title}-${keyword}-${keywordIndex}`} className="text-[10px] rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-blue-200">
                                                    #{keyword}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {(article.content || "").trim() && article.content !== article.description && (
                                        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300 font-mono leading-relaxed">
                                            {article.content}
                                        </pre>
                                    )}
                                </div>
                            </details>
                        )) : <p className="text-xs text-slate-500">No RSS/debug articles captured.</p>}
                    </div>
                </div>
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">FRED / EIA Validation Blocks</p>
                    <div className="space-y-3">
                        {validationEntries.map(([symbol, payload], index) => (
                            <div key={symbol || `validation-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-black text-white">{symbol}</p>
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400">{payload.status}</span>
                                </div>
                                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{payload.summary || "No summary available."}</p>
                                <div className="mt-3 space-y-2">
                                    {(payload.metrics ?? []).map((metric, metricIndex) => (
                                        <div key={`${symbol}-${metric.name}-${metricIndex}`} className="rounded border border-slate-800/90 px-3 py-2 text-xs">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-slate-300">{metric.label}</span>
                                                <span className="font-mono text-white">{metric.current ?? "n/a"}{metric.unit === "percent" ? "%" : ""}</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-3 mt-1 text-[10px] text-slate-500">
                                                <span>{metric.source}</span>
                                                <span>{metric.as_of || metric.status}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Recent Web Research</p>
                    <div className="space-y-3">
                        {webContextEntries.map(([symbol, summary]) => {
                            const items = modelInputs?.web_items_by_symbol?.[symbol] ?? [];
                            return (
                                <div key={symbol} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-sm font-black text-white">{symbol}</p>
                                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-300 font-mono leading-relaxed">
                                        {summary || "No recent web research summary captured."}
                                    </pre>
                                    {items.length > 0 && (
                                        <div className="mt-3 space-y-2">
                                            {items.map((item, index) => (
                                                <details key={`${symbol}-web-${index}`} className="rounded border border-slate-800/90 px-3 py-2 text-xs">
                                                    <summary className="cursor-pointer list-none">
                                                        <p className="text-slate-200">{item.title}</p>
                                                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                                                            <span>{item.source}</span>
                                                            {item.published_at && <span>{formatTs(item.published_at, timeZone)}</span>}
                                                            {Number.isFinite(item.relevance_score) && <span>score {item.relevance_score.toFixed(2)}</span>}
                                                            {Number.isFinite(item.age_days) && <span>{item.age_days.toFixed(1)}d old</span>}
                                                        </div>
                                                    </summary>
                                                    <div className="mt-3 border-t border-slate-800 pt-3">
                                                        {item.query && (
                                                            <p className="text-[10px] text-slate-500 break-words">
                                                                Query: <span className="font-mono">{item.query}</span>
                                                            </p>
                                                        )}
                                                        {item.summary && (
                                                            <p className="mt-2 text-xs text-slate-300 leading-relaxed">{item.summary}</p>
                                                        )}
                                                        {item.matched_keywords?.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {item.matched_keywords.map((keyword, keywordIndex) => (
                                                                    <span
                                                                        key={`${symbol}-matched-${keyword}-${keywordIndex}`}
                                                                        className="text-[10px] rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-200"
                                                                    >
                                                                        {keyword}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {item.url && (
                                                            <a
                                                                href={item.url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="mt-2 inline-block break-all text-[10px] text-blue-300 hover:text-blue-200"
                                                            >
                                                                {item.url}
                                                            </a>
                                                        )}
                                                    </div>
                                                </details>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {webContextEntries.length === 0 && webItemEntries.length === 0 && (
                            <p className="text-xs text-slate-500">Light web research was not enabled or no trusted recent items were captured.</p>
                        )}
                    </div>
                </div>
                <div className="space-y-4">
                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Red-Team Review Trace</p>
                        {redTeamDebug ? (
                            <div className="space-y-3">
                                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Blue Team</p>
                                            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-200 font-mono leading-relaxed">
                                                {JSON.stringify(blueTeamSignal ?? {}, null, 2)}
                                            </pre>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Consensus</p>
                                            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-200 font-mono leading-relaxed">
                                                {JSON.stringify(consensusSignal ?? {}, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-amber-300">What Changed</p>
                                    <div className="mt-2 space-y-2">
                                        {(redTeamDebug.signal_changes ?? []).map((change) => (
                                            <div key={`${change.symbol}-${change.change_type}`} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-white">{change.symbol}</p>
                                                        <p className="text-xs text-slate-400 mt-1">{change.blue_team_recommendation} {"->"} {change.consensus_recommendation}</p>
                                                    </div>
                                                    <span className={`rounded px-2 py-1 text-[10px] uppercase ${change.changed ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"}`}>
                                                        {change.change_type}
                                                    </span>
                                                </div>
                                                {change.rationale && <p className="mt-2 text-xs text-slate-300 leading-relaxed">{change.rationale}</p>}
                                                {(change.evidence ?? []).length > 0 && (
                                                    <div className="mt-2 space-y-1">
                                                        {change.evidence.map((item, index) => (
                                                            <p key={`${change.symbol}-evidence-${index}`} className="text-xs text-slate-400 leading-relaxed">{item}</p>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {(redTeamDebug.signal_changes ?? []).length === 0 && (
                                            <p className="text-xs text-slate-500">No red-team change trace was captured for this run.</p>
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Red-Team Prompt</p>
                                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300 font-mono leading-relaxed">
                                        {redTeamDebug.prompt || "No red-team prompt captured."}
                                    </pre>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Raw Red-Team Response</p>
                                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300 font-mono leading-relaxed">
                                        {redTeamDebug.raw_response || "No raw red-team response captured."}
                                    </pre>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500">No red-team debug trace captured for this run.</p>
                        )}
                    </div>
                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Per-Symbol Final Prompts</p>
                        <div className="space-y-3">
                            {Object.entries(modelInputs?.per_symbol_prompts ?? {}).map(([symbol, prompt], index) => (
                                <div key={symbol || `prompt-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-sm font-black text-white mb-2">{symbol}</p>
                                    <pre className="max-h-72 overflow-auto text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed">{prompt}</pre>
                                </div>
                            ))}
                            {Object.keys(modelInputs?.per_symbol_prompts ?? {}).length === 0 && (
                                <p className="text-xs text-slate-500">No per-symbol prompt previews captured.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </GlassCard>
    );
}

function TradeExecutionModal({
    recommendation,
    trade,
    onClose,
    onSave,
}: {
    recommendation: Recommendation | null;
    trade: PnLTrade | null;
    onClose: () => void;
    onSave: (payload: { executedAction: "BUY" | "SELL"; executedPrice: number; }) => Promise<void>;
}) {
    const [executedAction, setExecutedAction] = useState<"BUY" | "SELL">(
        (trade?.actual_execution?.executed_action as "BUY" | "SELL") || recommendation?.action || "BUY"
    );
    const [executedPrice, setExecutedPrice] = useState(
        trade?.actual_execution?.executed_price?.toString() || trade?.entry_price?.toString() || ""
    );
    const [isSaving, setIsSaving] = useState(false);

    if (!recommendation) return null;

    const submit = async () => {
        const numericPrice = Number(executedPrice);
        if (!numericPrice || numericPrice <= 0) return;
        setIsSaving(true);
        try {
            await onSave({ executedAction, executedPrice: numericPrice });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Log Your Trade</p>
                        <p className="text-xl font-black text-white mt-1">
                            {recommendation.symbol} {recommendation.action} {recommendation.leverage}
                        </p>
                        <p className="text-sm text-slate-400 mt-2">
                            {describeRecommendation(recommendation)}.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
                        Close
                    </button>
                </div>

                <div className="mt-5 space-y-4">
                    <div>
                        <p className="text-xs text-slate-400 mb-2">What did you actually do?</p>
                        <div className="flex gap-2">
                            {(["BUY", "SELL"] as const).map((action) => (
                                <button
                                    key={action}
                                    type="button"
                                    onClick={() => setExecutedAction(action)}
                                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${executedAction === action
                                            ? action === "BUY"
                                                ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                                                : "border-red-400 bg-red-500/10 text-red-300"
                                            : "border-slate-700 bg-slate-800 text-slate-300"
                                        }`}
                                >
                                    {action === "BUY" ? "Bought" : "Sold"}
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="block">
                        <span className="text-xs text-slate-400">Fill price</span>
                        <input
                            type="number"
                            step="0.01"
                            value={executedPrice}
                            onChange={(e) => setExecutedPrice(e.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-blue-400"
                            placeholder="Enter your trade price"
                        />
                    </label>

                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
                        Recommendation entry: <span className="text-white">{trade ? `$${trade.entry_price.toFixed(2)}` : "—"}</span>
                    </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={isSaving}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {isSaving ? "Saving..." : "Save Trade"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Maps leveraged/inverse execution tickers back to the underlying we have live prices for
const UNDERLYING_PRICE_MAP: Record<string, string> = {
    QLD: "QQQ", QID: "QQQ", TQQQ: "QQQ", SQQQ: "QQQ",
    SSO: "SPY", SDS: "SPY", SPXL: "SPY", SPXS: "SPY",
    UCO: "USO", SCO: "USO",
    BITU: "BITO", SBIT: "BITO",
};

const EXECUTION_SYMBOLS_BY_UNDERLYING: Record<string, string[]> = {
    QQQ: ["QQQ", "QLD", "QID", "TQQQ", "SQQQ"],
    SPY: ["SPY", "SSO", "SDS", "SPXL", "SPXS"],
    USO: ["USO", "UCO", "SCO"],
    BITO: ["BITO", "BITU", "SBIT"],
};

function livePnl(action: "BUY" | "SELL", entryPrice: number, currentPrice: number): number {
    const move = (currentPrice - entryPrice) / entryPrice * 100;
    return action === "SELL" ? -move : move;
}

function paperPnlUsd(pct: number, notionalUsd = 100) {
    return notionalUsd * (pct / 100);
}

function formatSignedUsd(value: number) {
    return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function ReturnCell({ pct, label, sub }: { pct: number; label: string; sub?: string }) {
    const pos = pct >= 0;
    return (
        <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">{label}</p>
            <p className={`text-sm font-bold ${pos ? "text-emerald-400" : "text-red-400"}`}>
                {pos ? "+" : ""}{pct.toFixed(2)}%
            </p>
            {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
        </div>
    );
}

function TradeCard({ trade, prices, onCloseTrade }: {
    trade: PnLTrade;
    prices: Prices | null;
    onCloseTrade: (tradeId: number, closedPrice: number, notes: string) => Promise<void>;
}) {
    const [showCloseForm, setShowCloseForm] = useState(false);
    const [closePrice, setClosePrice] = useState("");
    const [closeNotes, setCloseNotes] = useState("");
    const [isSavingClose, setIsSavingClose] = useState(false);
    const { timeZone } = useTimezone();

    const exec = trade.actual_execution;
    const closed = trade.trade_close;
    const paperNotionalUsd = trade.paper_notional_usd ?? 100;
    const paperShares = trade.paper_shares ?? (trade.entry_price > 0 ? paperNotionalUsd / trade.entry_price : 0);
    // Prefer the exact traded symbol's price; fall back to underlying (QQQ for TQQQ, etc.)
    const priceSymbol = prices?.[trade.symbol] ? trade.symbol : (UNDERLYING_PRICE_MAP[trade.symbol] ?? trade.symbol);
    const livePrice = prices?.[priceSymbol]?.price ?? null;
    const liveRecPnl = livePrice !== null ? livePnl(trade.action, trade.entry_price, livePrice) : null;
    const liveActPnl = exec && livePrice !== null ? livePnl(exec.executed_action, exec.executed_price, livePrice) : null;
    const liveRecPaperUsd = liveRecPnl !== null ? paperPnlUsd(liveRecPnl, paperNotionalUsd) : null;
    const liveActPaperUsd = liveActPnl !== null ? paperPnlUsd(liveActPnl, paperNotionalUsd) : null;

    const submitClose = async () => {
        const price = Number(closePrice);
        if (!price || price <= 0) return;
        setIsSavingClose(true);
        try {
            await onCloseTrade(trade.id, price, closeNotes);
            setShowCloseForm(false);
            setClosePrice("");
            setCloseNotes("");
        } finally {
            setIsSavingClose(false);
        }
    };

    return (
        <div className={`rounded-lg border p-4 ${closed ? "border-slate-600 bg-slate-900/70" : "border-gray-700 bg-gray-900/50"}`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <p className="text-sm font-black text-white">
                        {trade.symbol} · {trade.action} {trade.leverage}
                        {closed && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border border-slate-600 rounded px-1.5 py-0.5">Closed</span>}
                    </p>
                    {exec && <p className="text-xs text-gray-400 mt-0.5">You {exec.executed_action} @ ${exec.executed_price.toFixed(2)}</p>}
                    <p className="text-[10px] text-slate-600">Rec entry @ ${trade.entry_price.toFixed(2)}</p>
                    <p className="text-[10px] text-slate-500">$100 paper position · {paperShares.toFixed(4)} shares</p>
                </div>
                {exec && !closed && (
                    <button
                        type="button"
                        onClick={() => setShowCloseForm((v) => !v)}
                        className="text-[10px] font-semibold uppercase tracking-wider border border-slate-600 rounded px-2 py-1 text-slate-400 hover:text-white hover:border-slate-400 shrink-0"
                    >
                        {showCloseForm ? "Cancel" : "Close Position"}
                    </button>
                )}
            </div>

            {/* Closed — realized P&L */}
            {closed && (
                <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                        Realized · closed @ ${closed.closed_price.toFixed(2)} · {formatTs(closed.closed_at, timeZone)}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <ReturnCell pct={closed.closed_return_pct} label="Rec realized" />
                        {closed.exec_closed_return_pct != null && (
                            <ReturnCell pct={closed.exec_closed_return_pct} label="Your realized" />
                        )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Paper realized</p>
                            <p className={`text-sm font-bold ${(closed.paper_pnl_usd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {formatSignedUsd(closed.paper_pnl_usd ?? 0)}
                            </p>
                        </div>
                        {closed.exec_paper_pnl_usd != null && (
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Your paper realized</p>
                                <p className={`text-sm font-bold ${closed.exec_paper_pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {formatSignedUsd(closed.exec_paper_pnl_usd)}
                                </p>
                            </div>
                        )}
                    </div>
                    {closed.notes && <p className="text-[10px] text-slate-500 mt-2">{closed.notes}</p>}
                </div>
            )}

            {/* Close form */}
            {showCloseForm && (
                <div className="mb-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-blue-300">Log Close Price</p>
                    <div className="flex gap-2">
                        <input
                            type="number"
                            step="0.01"
                            placeholder="Close price"
                            value={closePrice}
                            onChange={(e) => setClosePrice(e.target.value)}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white outline-none focus:border-blue-400"
                        />
                        <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={closeNotes}
                            onChange={(e) => setCloseNotes(e.target.value)}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white outline-none focus:border-blue-400"
                        />
                        <button
                            type="button"
                            onClick={submitClose}
                            disabled={isSavingClose || !closePrice}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {isSavingClose ? "Saving…" : "Save"}
                        </button>
                    </div>
                </div>
            )}

            {/* Open — live P&L */}
            {!closed && (
                liveRecPnl !== null ? (
                    <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                            Live · {priceSymbol} ${livePrice?.toFixed(2)}
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <ReturnCell pct={liveRecPnl} label="Rec (live)" />
                            {liveActPnl !== null
                                ? <ReturnCell pct={liveActPnl} label="Your (live)" />
                                : <div className="text-[10px] text-slate-600 italic pt-2">No execution</div>
                            }
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Paper P&L</p>
                                <p className={`text-sm font-bold ${(liveRecPaperUsd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {formatSignedUsd(liveRecPaperUsd ?? 0)}
                                </p>
                            </div>
                            {liveActPaperUsd !== null ? (
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Your paper P&L</p>
                                    <p className={`text-sm font-bold ${liveActPaperUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                        {formatSignedUsd(liveActPaperUsd)}
                                    </p>
                                </div>
                            ) : (
                                <div className="text-[10px] text-slate-600 italic pt-2">No execution</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-slate-600 italic">Live price unavailable</p>
                )
            )}
        </div>
    );
}

function ActualTradeComparisonCard({ pnlSummary, currentRequestId, prices, onCloseTrade }: {
    pnlSummary: PnLSummary | null;
    currentRequestId?: string;
    prices: Prices | null;
    onCloseTrade: (tradeId: number, closedPrice: number, notes: string) => Promise<void>;
}) {
    const allExecuted = (pnlSummary?.trades ?? [])
        .filter((t) => t.actual_execution)
        .sort((a, b) => new Date(b.actual_execution!.executed_at).getTime() - new Date(a.actual_execution!.executed_at).getTime());

    if (allExecuted.length === 0) return null;

    const openTrades = allExecuted.filter((t) => !t.trade_close);
    const closedTrades = allExecuted.filter((t) => !!t.trade_close);

    // All-time P&L: sum of exec realized returns (fall back to rec realized if no exec return)
    const allTimePnl = closedTrades.reduce((sum, t) => {
        const pct = t.trade_close!.exec_closed_return_pct ?? t.trade_close!.closed_return_pct;
        return sum + pct;
    }, 0);
    const wins = closedTrades.filter((t) => {
        const pct = t.trade_close!.exec_closed_return_pct ?? t.trade_close!.closed_return_pct;
        return pct > 0;
    }).length;

    return (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
            {/* All-time P&L banner */}
            {closedTrades.length > 0 && (
                <div className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-4">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-2">All-time realized P&L</p>
                    <div className="flex items-baseline gap-3">
                        <span className={`text-2xl font-black tabular-nums ${allTimePnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {allTimePnl >= 0 ? "+" : ""}{allTimePnl.toFixed(2)}%
                        </span>
                        <span className="text-xs text-slate-500">
                            {wins}W / {closedTrades.length - wins}L across {closedTrades.length} closed trade{closedTrades.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                </div>
            )}

            {/* Open positions */}
            {openTrades.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Open positions</p>
                    {openTrades.map((trade) => (
                        <TradeCard key={trade.id} trade={trade} prices={prices} onCloseTrade={onCloseTrade} />
                    ))}
                </div>
            )}

            {/* Closed positions */}
            {closedTrades.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Closed positions</p>
                    {closedTrades.map((trade) => (
                        <TradeCard key={trade.id} trade={trade} prices={prices} onCloseTrade={onCloseTrade} />
                    ))}
                </div>
            )}
        </motion.div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
    const { setTimeZone } = useTimezone();
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
    const [configLoaded, setConfigLoaded] = useState(false);
    const [pnlSummary, setPnlSummary] = useState<PnLSummary | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [expandedIdxs, setExpandedIdxs] = useState<Set<number>>(new Set());
    const [prices, setPrices] = useState<Prices | null>(null);
    const [countdown, setCountdown] = useState(DEFAULT_APP_CONFIG.auto_run_interval_minutes * 60);
    const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
    const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [latestLogMessage, setLatestLogMessage] = useState("");
    const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);
    const [advancedMode, setAdvancedMode] = useState(false);
    const [activeTab, setActiveTab] = useState<"current" | "history" | "compare" | "debug">("current");
    const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
    const [analysisSnapshots, setAnalysisSnapshots] = useState<AnalysisSnapshotItem[]>([]);
    const [goldenDatasetRequestId, setGoldenDatasetRequestId] = useState("");
    const [goldenBaselineResult, setGoldenBaselineResult] = useState<AnalysisResult | null>(null);
    const [comparisonResult, setComparisonResult] = useState<AnalysisResult | null>(null);
    const [comparisonBaselineResult, setComparisonBaselineResult] = useState<AnalysisResult | null>(null);
    const [comparisonLoading, setComparisonLoading] = useState(false);
    const [comparisonError, setComparisonError] = useState<string | null>(null);
    const [benchmarkResults, setBenchmarkResults] = useState<AnalysisResult[]>([]);
    const [savedComparisonBaseline, setSavedComparisonBaseline] = useState<AnalysisResult | null>(null);
    const [savedComparisonResult, setSavedComparisonResult] = useState<AnalysisResult | null>(null);
    const [savedComparisonLoading, setSavedComparisonLoading] = useState(false);
    const [savedComparisonError, setSavedComparisonError] = useState<string | null>(null);
    const [showCompletedProgressUntil, setShowCompletedProgressUntil] = useState<number | null>(null);
    const [restoringLastResult, setRestoringLastResult] = useState(true);
    const articleCounter = useRef(0);
    const autoRunStartedRef = useRef(false);
    const historySectionRef = useRef<HTMLDivElement | null>(null);
    const trackedSymbols = config.tracked_symbols.length > 0 ? config.tracked_symbols : DEFAULT_APP_CONFIG.tracked_symbols;
    // Memoized so fetchPrices (which lists this as a dep) doesn't recreate on every render,
    // which would trigger the polling useEffect in a tight loop.
    const pricePanelSymbols = useMemo(() => {
        const openTradeSymbols = (pnlSummary?.trades ?? [])
            .filter((t) => !t.trade_close)
            .map((t) => t.symbol);
        return Array.from(new Set([...trackedSymbols, ...openTradeSymbols]));
    }, [trackedSymbols, pnlSummary]);

    // Keep stable refs for the auto-run effect
    const isAnalyzingRef = useRef(false);
    useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);

    // Stable ref for handleAnalyze — lets the countdown interval avoid listing it as a dep,
    // which would otherwise tear down and recreate the interval whenever upstream deps change.
    const handleAnalyzeRef = useRef<() => void>(() => {});
    // Ref mirror of countdown state — lets the interval read current value without a stale closure.
    const countdownRef = useRef(countdown);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const nextConfig = await response.json() as AppConfig;

            // Merge with localStorage run times for progress estimation
            const storedTimes = typeof window !== "undefined"
                ? localStorage.getItem("recentAnalysisTimes")
                : null;
            if (storedTimes) {
                const recentTimes = JSON.parse(storedTimes) as number[];
                nextConfig.recent_analysis_seconds = recentTimes;
                nextConfig.estimated_analysis_seconds = Math.ceil(recentTimes.reduce((a: number, b: number) => a + b, 0) / recentTimes.length);
            }

            setConfig(nextConfig);
            setTimeZone(nextConfig.display_timezone || "");
            setCountdown(nextConfig.seconds_until_next_auto_run);
            setConfigLoaded(true);
        } catch { }
    }, [setTimeZone]);

    const handleAnalyze = useCallback(async () => {
        if (isAnalyzingRef.current) return;
        setIsAnalyzing(true);
        setError(null);
        setFeed([]);
        setExpandedIdxs(new Set());
        setResult(null);
        setCountdown(config.auto_run_interval_minutes * 60);
        setAnalysisStartedAt(Date.now());
        setStreamStartedAt(null);
        setElapsedSeconds(0);
        setLatestLogMessage("Connecting to backend...");
        setComparisonResult(null);
        setComparisonError(null);
        setSavedComparisonBaseline(null);
        setSavedComparisonResult(null);
        setSavedComparisonError(null);
        setShowCompletedProgressUntil(null);
        articleCounter.current = 0;

        try {
            const response = await fetch("/api/analyze/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbols: trackedSymbols,
                    max_posts: config.max_posts,
                    lookback_days: config.lookback_days,
                }),
            });
            if (!response.ok || !response.body) throw new Error(`Server error: ${response.statusText}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (!streamStartedAt) {
                            setStreamStartedAt(Date.now());
                        }
                        if (event.type === "log") {
                            setLatestLogMessage(event.message);
                            setFeed((p) => [...p, { kind: "log", message: event.message }]);
                        } else if (event.type === "article") {
                            const idx = articleCounter.current++;
                            setFeed((p) => [...p, { kind: "article", idx, source: event.source, title: event.title, description: event.description ?? "", keywords: event.keywords ?? [] }]);
                        } else if (event.type === "result") {
                            setResult(event.data);
                            setShowCompletedProgressUntil(Date.now() + 1200);
                            // Track completion time for progress estimation
                            if (analysisStartedAt) {
                                const completionSeconds = Math.round((Date.now() - analysisStartedAt) / 1000);
                                // Load existing times from localStorage
                                const storedTimes = localStorage.getItem("recentAnalysisTimes");
                                const recentTimes = storedTimes ? JSON.parse(storedTimes) : [];
                                // Keep last 10 runs
                                const updatedTimes = [...recentTimes, completionSeconds].slice(-10);
                                localStorage.setItem("recentAnalysisTimes", JSON.stringify(updatedTimes));

                                // Calculate average for better estimates
                                const avgSeconds = Math.ceil(updatedTimes.reduce((a, b) => a + b, 0) / updatedTimes.length);
                                setConfig((prev) => ({
                                    ...prev,
                                    recent_analysis_seconds: updatedTimes,
                                    estimated_analysis_seconds: avgSeconds,
                                }));
                            }
                            void fetchPnl();
                        } else if (event.type === "error") {
                            setError(event.message);
                        }
                    } catch { /* malformed */ }
                }
            }
        } catch (err: any) {
            setError(err.message || "Failed to connect to backend");
        } finally {
            setIsAnalyzing(false);
            setAnalysisStartedAt(null);
            setStreamStartedAt(null);
            void fetchConfig();
        }
    }, [config.lookback_days, config.max_posts, config.auto_run_interval_minutes, trackedSymbols, fetchConfig, streamStartedAt]);

    const fetchPnl = useCallback(async () => {
        try {
            const response = await fetch("/api/pnl", { cache: "no-store" });
            if (response.ok) {
                setPnlSummary(await response.json());
            }
        } catch { }
    }, []);

    const fetchOllamaStatus = useCallback(async () => {
        try {
            const response = await fetch("/api/ollama/status", { cache: "no-store" });
            if (response.ok) {
                setOllamaStatus(await response.json());
            }
        } catch { }
    }, []);

    const fetchAnalysisSnapshots = useCallback(async () => {
        try {
            const response = await fetch("/api/analyze/snapshots?limit=12", { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json();
            setAnalysisSnapshots(payload.items || []);
        } catch { }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = localStorage.getItem(GOLDEN_DATASET_REQUEST_ID_KEY) || "";
        if (saved) setGoldenDatasetRequestId(saved);
    }, []);

    const fetchSnapshotDetail = useCallback(async (requestId: string) => {
        const response = await fetch(`/api/analyze/snapshots/${encodeURIComponent(requestId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.detail?.message || payload?.error || "Failed to load saved run");
        }
        return payload as AnalysisResult;
    }, []);

    const restoreLastViewedResult = useCallback(async () => {
        try {
            const response = await fetch("/api/analyze/snapshots?limit=12", { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json();
            const items = (payload.items || []) as AnalysisSnapshotItem[];
            setAnalysisSnapshots(items);

            const availableSnapshots = items.filter((item) => item.snapshot_available);
            if (availableSnapshots.length === 0) return;

            const storedRequestId = typeof window !== "undefined"
                ? localStorage.getItem(LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY)
                : null;
            const preferredSnapshot = (
                storedRequestId
                    ? availableSnapshots.find((item) => item.request_id === storedRequestId)
                    : null
            ) || availableSnapshots[0];

            if (!preferredSnapshot) return;

            const restored = await fetchSnapshotDetail(preferredSnapshot.request_id);
            if (isAnalyzingRef.current) return;
            setResult(restored);
        } catch { }
        finally {
            setRestoringLastResult(false);
        }
    }, [fetchSnapshotDetail]);

    const handleCloseTrade = useCallback(async (tradeId: number, closedPrice: number, notes: string) => {
        await fetch(`/api/trades/${tradeId}/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ closed_price: closedPrice, notes }),
        });
        void fetchPnl();
    }, [fetchPnl]);

    const handleDeleteTrade = useCallback(async (tradeId: number) => {
        const res = await fetch(`/api/trades/${tradeId}`, { method: "DELETE" });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload?.error || "Failed to delete trade");
        }
        void fetchPnl();
    }, [fetchPnl]);

    const handleRerunSnapshot = useCallback(async (
        requestId: string,
        modelName: string,
        extractionModel?: string,
        reasoningModel?: string,
    ) => {
        if (!requestId || (!modelName && !extractionModel)) return;
        setComparisonLoading(true);
        setComparisonError(null);
        try {
            const baselinePromise = result?.request_id === requestId && result
                ? Promise.resolve(result)
                : fetchSnapshotDetail(requestId);
            const responsePromise = fetch("/api/analyze/rerun", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    request_id: requestId,
                    ...(modelName ? { model_name: modelName } : {}),
                    ...(extractionModel ? { extraction_model: extractionModel } : {}),
                    ...(reasoningModel ? { reasoning_model: reasoningModel } : {}),
                }),
            });
            const [baselinePayload, response] = await Promise.all([baselinePromise, responsePromise]);
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.detail?.message || payload?.error || "Failed to rerun snapshot");
            }
            setComparisonBaselineResult(baselinePayload);
            setComparisonResult(payload);
            if (requestId === goldenDatasetRequestId) {
                setGoldenBaselineResult(baselinePayload);
                setBenchmarkResults((current) => {
                    const next = [payload as AnalysisResult, ...current.filter((item) => item.request_id !== payload.request_id)];
                    return next.slice(0, 8);
                });
            }
            void fetchPnl();
            void fetchAnalysisSnapshots();
        } catch (err: any) {
            setComparisonError(err.message || "Failed to rerun snapshot");
        } finally {
            setComparisonLoading(false);
        }
    }, [fetchAnalysisSnapshots, fetchPnl, fetchSnapshotDetail, goldenDatasetRequestId, result]);

    const handleCompareSavedRuns = useCallback(async (baselineRequestId: string, comparisonRequestId: string) => {
        if (!baselineRequestId || !comparisonRequestId || baselineRequestId === comparisonRequestId) return;
        setSavedComparisonLoading(true);
        setSavedComparisonError(null);
        try {
            const [baselinePayload, comparisonPayload] = await Promise.all([
                fetchSnapshotDetail(baselineRequestId),
                fetchSnapshotDetail(comparisonRequestId),
            ]);
            setSavedComparisonBaseline(baselinePayload);
            setSavedComparisonResult(comparisonPayload);
        } catch (err: any) {
            setSavedComparisonError(err.message || "Failed to compare saved runs");
        } finally {
            setSavedComparisonLoading(false);
        }
    }, [fetchSnapshotDetail]);

    const handleSelectGoldenDataset = useCallback(async (requestId: string) => {
        setGoldenDatasetRequestId(requestId);
        if (typeof window !== "undefined") {
            localStorage.setItem(GOLDEN_DATASET_REQUEST_ID_KEY, requestId);
        }
        setBenchmarkResults([]);
        if (result?.request_id === requestId && result) {
            setGoldenBaselineResult(result);
            return;
        }
        try {
            const payload = await fetchSnapshotDetail(requestId);
            setGoldenBaselineResult(payload);
        } catch {
            setGoldenBaselineResult(null);
        }
    }, [fetchSnapshotDetail, result]);

    const handleClearBenchmarks = useCallback(() => {
        setBenchmarkResults([]);
        setGoldenBaselineResult(null);
    }, []);

    useEffect(() => {
        const timerStart = streamStartedAt ?? analysisStartedAt;
        if (!isAnalyzing || !timerStart) return;
        const id = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - timerStart) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [isAnalyzing, analysisStartedAt, streamStartedAt]);

    // Keep refs in sync — must appear before the countdown effect below.
    useEffect(() => { handleAnalyzeRef.current = handleAnalyze; }, [handleAnalyze]);
    useEffect(() => { countdownRef.current = countdown; }, [countdown]);

    // Auto-run countdown.
    // handleAnalyze is intentionally NOT in the dep array — we access it via handleAnalyzeRef
    // so the interval is never torn down just because handleAnalyze changed identity.
    // The side effect (calling handleAnalyze) is fired directly inside the setInterval callback,
    // NOT inside a setCountdown state-updater, which React StrictMode would double-invoke.
    useEffect(() => {
        if (!configLoaded || !config.auto_run_enabled) return;
        const intervalSecs = config.auto_run_interval_minutes * 60;
        const tick = setInterval(() => {
            if (isAnalyzingRef.current) return;
            const c = countdownRef.current;
            if (c <= 1) {
                countdownRef.current = intervalSecs;
                setCountdown(intervalSecs);
                autoRunStartedRef.current = true;
                handleAnalyzeRef.current();
            } else {
                countdownRef.current = c - 1;
                setCountdown(c - 1);
            }
        }, 1000);
        return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.auto_run_enabled, config.auto_run_interval_minutes, configLoaded]);

    useEffect(() => {
        void fetchConfig();
    }, [fetchConfig]);

    useEffect(() => {
        if (!configLoaded || restoringLastResult || isAnalyzing || autoRunStartedRef.current) return;
        if (config.auto_run_enabled && config.can_auto_run_now && !result && feed.length === 0) {
            autoRunStartedRef.current = true;
            void handleAnalyze();
        }
    }, [config, configLoaded, feed.length, handleAnalyze, isAnalyzing, restoringLastResult, result]);

    // Price polling
    const fetchPrices = useCallback(async () => {
        try {
            const query = pricePanelSymbols.length > 0 ? `?symbols=${encodeURIComponent(pricePanelSymbols.join(","))}` : "";
            const r = await fetch(`/api/prices${query}`);
            if (r.ok) setPrices(await r.json());
        } catch { }
    }, [pricePanelSymbols]);

    useEffect(() => {
        fetchPrices();
        const id = setInterval(fetchPrices, 300_000); // matches 5-min backend cache TTL
        return () => clearInterval(id);
    }, [fetchPrices]);

    useEffect(() => {
        fetchPnl();
    }, [fetchPnl]);

    useEffect(() => {
        void fetchOllamaStatus();
        const id = setInterval(fetchOllamaStatus, 15_000);
        return () => clearInterval(id);
    }, [fetchOllamaStatus]);

    useEffect(() => {
        void fetchAnalysisSnapshots();
    }, [fetchAnalysisSnapshots, result?.request_id]);

    useEffect(() => {
        void restoreLastViewedResult();
    }, [restoreLastViewedResult]);

    useEffect(() => {
        if (!result?.request_id || typeof window === "undefined") return;
        localStorage.setItem(LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY, result.request_id);
    }, [result?.request_id]);

    useEffect(() => {
        if (comparisonResult || savedComparisonResult) setActiveTab("compare");
    }, [comparisonResult, savedComparisonResult]);

    useEffect(() => {
        if (!showCompletedProgressUntil) return;
        const delay = Math.max(0, showCompletedProgressUntil - Date.now());
        const id = window.setTimeout(() => setShowCompletedProgressUntil(null), delay);
        return () => window.clearTimeout(id);
    }, [showCompletedProgressUntil]);

    useEffect(() => {
        if (!advancedMode && activeTab === "debug") setActiveTab("current");
    }, [advancedMode, activeTab]);

    useEffect(() => {
        if (activeTab !== "history") return;
        const id = window.setTimeout(() => {
            historySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
        return () => window.clearTimeout(id);
    }, [activeTab]);

    const toggleArticle = (idx: number) => {
        setExpandedIdxs((prev) => {
            const next = new Set(prev);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return next;
        });
    };

    const isOllamaError = error?.toLowerCase().includes("ollama");
    const activeModelLabel = ollamaStatus?.active_model || ollamaStatus?.configured_model || "No model detected";
    const ollamaCommandModel = ollamaStatus?.active_model || ollamaStatus?.configured_model || "the-first-model-you-served";
    const feedCountLabel = `${config.enabled_rss_feeds.length || DEFAULT_APP_CONFIG.enabled_rss_feeds.length} RSS sources`;
    const currentRequestTrades = (pnlSummary?.trades ?? []).filter((trade) => trade.request_id === result?.request_id);
    const selectedTrade = selectedRecommendation
        ? currentRequestTrades.find((trade) => trade.symbol === selectedRecommendation.symbol && trade.action === selectedRecommendation.action)
        : null;
    const articleItems = feed.filter((f): f is FeedItem & { kind: "article" } => f.kind === "article");
    const mm = Math.floor(countdown / 60);
    const ss = countdown % 60;
    const stageIndex = (() => {
        const message = latestLogMessage.toLowerCase();
        let best = 0;
        ANALYSIS_STAGES.forEach((stage, index) => {
            if (stage.matches.some((token) => message.includes(token.toLowerCase()))) {
                best = Math.max(best, index);
            }
        });
        return best;
    })();
    const stageLabel = ANALYSIS_STAGES[stageIndex]?.label ?? "Running analysis";
    const recentAnalysisTimes = config.recent_analysis_seconds || [];
    const timing = estimateRunTiming(recentAnalysisTimes, config.estimated_analysis_seconds || 82);
    const hasReliableHistory = timing.reliable;
    const estimatedAnalysisSeconds = timing.expectedSeconds;
    const pacingSeconds = timing.pacingSeconds;
    const elapsedRatio = pacingSeconds > 0 ? elapsedSeconds / pacingSeconds : 0;
    const rawProgressPct = clamp(elapsedRatio * 100, 0, 99);
    const justCompleted = !!(showCompletedProgressUntil && Date.now() < showCompletedProgressUntil);
    const progressPct = justCompleted ? 100 : rawProgressPct;
    const etaSeconds = justCompleted
        ? 0
        : isAnalyzing
            ? Math.max(0, Math.round(pacingSeconds - elapsedSeconds))
            : 0;
    const isWaitingForStream = isAnalyzing && !streamStartedAt;
    const showAnalysisStatusCard = isAnalyzing || justCompleted;

    const saveTradeExecution = useCallback(async (payload: { executedAction: "BUY" | "SELL"; executedPrice: number; }) => {
        if (!selectedTrade) return;
        const response = await fetch(`/api/trades/${selectedTrade.id}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                executed_action: payload.executedAction,
                executed_price: payload.executedPrice,
            }),
        });
        if (!response.ok) {
            throw new Error("Failed to save trade");
        }
        await fetchPnl();
        setSelectedRecommendation(null);
    }, [fetchPnl, selectedTrade]);

    return (
        <div className="min-h-screen" style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}>

            {/* ── Header ── */}
            <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                    <button type="button" onClick={() => setActiveTab("current")} className="text-left shrink-0">
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                            Sentiment Trading Alpha
                        </h1>
                        <p className="text-slate-500 text-xs mt-0.5">{trackedSymbols.join(" · ")} | Geopolitical Sentiment Pipeline</p>
                    </button>

                    {/* ── Primary nav tabs ── */}
                    <nav className="flex items-center gap-1 rounded-xl p-1 shrink-0" style={{ background: "rgba(15,23,42,0.8)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        {(["current", "history", "compare", ...(advancedMode ? ["debug"] : [])] as ("current" | "history" | "compare" | "debug")[]).map((tab) => {
                            const labels: Record<string, string> = { current: "Signal", history: "History", compare: "Compare", debug: "Debug" };
                            const isActive = activeTab === tab;
                            const hasDot = tab === "compare" && (!!comparisonResult || !!savedComparisonResult);
                            return (
                                <Fragment key={tab}>
                                    {tab === "compare" && (
                                        <Link
                                            href="/trading"
                                            className="flex items-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold transition-colors text-emerald-400 hover:text-emerald-200 hover:bg-slate-800/60"
                                        >
                                            Trading
                                        </Link>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(tab)}
                                        className={`flex items-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold transition-colors ${isActive ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                                            }`}
                                    >
                                        {labels[tab]}
                                        {hasDot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                                    </button>
                                </Fragment>
                            );
                        })}
                    </nav>

                    <div className="flex items-center gap-3 shrink-0">
                        {error && (
                            <span className="flex items-center gap-1.5 text-xs bg-red-500/10 text-red-400 px-2.5 py-1 rounded-full border border-red-500/20">
                                <WifiOff size={11} /> {isOllamaError ? "Ollama" : "Error"}
                            </span>
                        )}
                        <div className="text-right hidden sm:block">
                            <p className="text-[11px] text-slate-500">Status</p>
                            <p className={`text-xs font-semibold ${isAnalyzing ? "text-yellow-400" : result ? "text-emerald-400" : "text-slate-400"}`}>
                                {isAnalyzing ? "Analyzing…" : result ? "Ready" : "Idle"}
                            </p>
                        </div>
                        <Link href="/about" className="text-xs text-slate-400 hover:text-white border border-slate-700/60 rounded-lg px-2.5 py-1.5">
                            About
                        </Link>
                        <Link href="/health" className="text-xs text-emerald-400 hover:text-emerald-200 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                            Health
                        </Link>
                        <Link href="/admin" className="text-xs text-blue-400 hover:text-blue-200 border border-blue-500/20 rounded-lg px-2.5 py-1.5">
                            Admin
                        </Link>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* ── Left Sidebar ── */}
                    <div className="space-y-4">

                        {/* Engine Config */}
                        <GlassCard>
                            <h2 className="text-sm font-semibold text-slate-300 mb-4">Engine Config</h2>
                            <div className="space-y-2.5 text-sm mb-5">
                                {(() => {
                                    const em = config.extraction_model?.trim();
                                    const rm = config.reasoning_model?.trim();
                                    const twoStage = !!(em && rm);
                                    const lightSingle = !!(em && !rm && config.rss_article_detail_mode === "light");
                                    const modelRows = twoStage
                                        ? [
                                            { label: "Stage 1 (extract)", val: em!, cls: "text-blue-300 font-mono text-xs" },
                                            { label: "Stage 2 (reason)", val: rm!, cls: "text-violet-300 font-mono text-xs" },
                                        ]
                                        : [{ label: lightSingle ? "Model (Light)" : "Model", val: em || activeModelLabel, cls: "text-blue-300 font-mono text-xs" }];
                                    return [
                                        ...modelRows,
                                        { label: "Feeds", val: feedCountLabel, cls: "font-mono text-xs" },
                                        { label: "Symbols", val: trackedSymbols.join(", "), cls: "font-mono text-xs" },
                                        (() => {
                                            const profile = config.risk_profile || "aggressive";
                                            const leverageMap: Record<string, string> = {
                                                conservative: "1x+inv",
                                                moderate: "≤2x",
                                                aggressive: "≤3x",
                                                crazy: "3x",
                                            };
                                            const profileLabel = profile.charAt(0).toUpperCase() + profile.slice(1);
                                            const leverageLabel = leverageMap[profile] ?? "3x";
                                            const clsMap: Record<string, string> = {
                                                conservative: "text-blue-400",
                                                moderate: "text-teal-400",
                                                aggressive: "text-orange-400",
                                                crazy: "text-rose-400",
                                            };
                                            return { label: "Risk", val: `${profileLabel} (${leverageLabel})`, cls: `font-mono text-xs font-bold ${clsMap[profile] ?? "text-orange-400"}` };
                                        })(),
                                    ].map(({ label, val, cls }) => (
                                        <div key={label} className="flex justify-between border-b border-slate-700/40 pb-2 last:border-0">
                                            <span className="text-slate-400">{label}</span>
                                            <span className={cls}>{val}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                            <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 py-2 text-xs">
                                <p className="text-slate-500 uppercase tracking-wider mb-1">Runtime</p>
                                <p className={ollamaStatus?.reachable ? "text-emerald-300" : "text-orange-300"}>
                                    {ollamaStatus?.reachable ? "Ollama reachable" : "Waiting for Ollama"}
                                </p>
                                <p className="text-slate-400 mt-1">
                                    {ollamaStatus?.reachable
                                        ? (config.extraction_model?.trim() && config.reasoning_model?.trim()
                                            ? `${config.extraction_model} → ${config.reasoning_model}`
                                            : `Using served model: ${config.extraction_model?.trim() || activeModelLabel}`)
                                        : "The dashboard will use whichever local model Ollama is currently serving."}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAdvancedMode((current) => !current)}
                                className={`w-full mb-3 py-2 rounded-xl font-semibold text-xs border transition-colors ${advancedMode
                                        ? "border-blue-400/40 bg-blue-500/10 text-blue-200"
                                        : "border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-800"
                                    }`}
                            >
                                {advancedMode ? "Advanced Mode On" : "Advanced Mode Off"}
                            </button>
                            <button onClick={handleAnalyze} disabled={isAnalyzing}
                                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${isAnalyzing ? "bg-slate-700 cursor-not-allowed text-slate-400" : "bg-blue-600 hover:bg-blue-500 text-white"
                                    }`}>
                                {isAnalyzing ? <><Activity size={14} className="animate-spin" /> Analyzing…</> :
                                    result ? <>Run Again <ArrowRight size={14} /></> :
                                        <>Analyze Market <ArrowRight size={14} /></>}
                            </button>
                            {/* Auto-run countdown */}
                            <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-slate-600">
                                <Clock size={11} />
                                <span>{config.auto_run_enabled ? `Auto-run in ${mm}:${ss.toString().padStart(2, "0")}` : "Auto-run disabled"}</span>
                            </div>
                        </GlassCard>

                        {/* Live Prices */}
                        <GlassCard>
                            <h2 className="text-sm font-semibold text-slate-300 mb-3">Market Prices</h2>
                            {prices ? (
                                <div>
                                    {trackedSymbols
                                        .filter((symbol) => prices[symbol])
                                        .map((symbol) => (
                                            <PriceRow key={symbol} symbol={symbol} q={prices[symbol]} />
                                        ))}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-600 italic">Loading…</p>
                            )}
                        </GlassCard>

                        {/* Signal Logic */}
                        <GlassCard>
                            <h2 className="text-sm font-semibold text-slate-300 mb-3">Signal Logic</h2>
                            <div className="space-y-2">
                                {SIGNAL_RULES.map(({ border, bg, label, labelColor, desc }) => (
                                    <div key={label} className={`border-l-4 ${border} ${bg} p-2.5 rounded-r-lg`}>
                                        <p className={`text-xs font-bold uppercase ${labelColor}`}>{label}</p>
                                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">{desc}</p>
                                    </div>
                                ))}
                            </div>
                        </GlassCard>

                        {/* Run Stats */}
                        {result && (
                            <GlassCard>
                                <h2 className="text-sm font-semibold text-slate-300 mb-3">Run Stats</h2>
                                <div className="space-y-1.5 text-sm">
                                    {[
                                        { label: "Articles", val: result.posts_scraped },
                                        { label: "Symbols", val: result.symbols_analyzed?.join(", ") },
                                        { label: "Duration", val: `${(result.processing_time_ms / 1000).toFixed(1)}s` },
                                    ].map(({ label, val }) => (
                                        <div key={label} className="flex justify-between">
                                            <span className="text-slate-400 text-xs">{label}</span>
                                            <span className="font-mono text-xs">{val}</span>
                                        </div>
                                    ))}
                                </div>
                            </GlassCard>
                        )}
                    </div>

                    {/* ── Main Content ── */}
                    <div className="lg:col-span-2 space-y-5">

                        {/* Error Banner */}
                        <AnimatePresence>
                            {error && (
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                    className={`p-4 rounded-xl border flex items-start gap-3 ${isOllamaError
                                        ? "bg-orange-950/60 border-orange-700/50 text-orange-300"
                                        : "bg-red-950/60 border-red-700/50 text-red-300"}`}>
                                    <WifiOff size={16} className="mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-semibold text-sm">{isOllamaError ? "Ollama not reachable" : "Error"}</p>
                                        <p className="text-sm mt-0.5 opacity-80">{error}</p>
                                        {isOllamaError && (
                                            <code className="text-xs mt-2 block bg-black/40 px-3 py-1.5 rounded font-mono">
                                                ollama run {ollamaCommandModel}
                                            </code>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Signal Hero (results) */}
                        <AnimatePresence>
                            {showAnalysisStatusCard && (
                                <motion.div key="analysis-status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                                    <AnalysisStatusCard
                                        stageLabel={stageLabel}
                                        progressPct={progressPct}
                                        elapsedSeconds={elapsedSeconds}
                                        etaSeconds={etaSeconds}
                                        latestMessage={latestLogMessage || "Waiting for the next pipeline update..."}
                                        isWaitingForStream={isWaitingForStream}
                                        hasReliableHistory={hasReliableHistory}
                                    />
                                </motion.div>
                            )}
                            {result && (
                                <motion.div key={`analysis-result-${result.request_id || "latest"}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                                    <SignalHero
                                        signal={result.trading_signal}
                                        redTeamReview={result.red_team_review}
                                        sentimentScores={result.sentiment_scores}
                                        trackedSymbols={trackedSymbols}
                                        trackedTrades={currentRequestTrades}
                                        onRecommendationClick={setSelectedRecommendation}
                                    />

                                    {activeTab === "current" && (
                                        <div className="space-y-4">
                                            <SentimentTicker data={result.sentiment_scores} />
                                            <ActualTradeComparisonCard pnlSummary={pnlSummary} currentRequestId={result.request_id} prices={prices} onCloseTrade={handleCloseTrade} />
                                        </div>
                                    )}
                                    {activeTab === "debug" && advancedMode && (
                                        <DebugPanel result={result} />
                                    )}
                                </motion.div>
                            )}

                            {activeTab === "history" && (
                                <motion.div ref={historySectionRef} key="tab-history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                                    <PullHistoryCard snapshots={analysisSnapshots} currentRequestId={result?.request_id} />
                                </motion.div>
                            )}
                            {activeTab === "compare" && (
                                <motion.div key="tab-compare" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                                    <ModelComparePanel
                                        result={result ?? null}
                                        snapshots={analysisSnapshots}
                                        availableModels={ollamaStatus?.available_models ?? []}
                                        compareBaselineResult={comparisonBaselineResult}
                                        compareResult={comparisonResult}
                                        goldenDatasetRequestId={goldenDatasetRequestId}
                                        goldenBaselineResult={goldenBaselineResult}
                                        benchmarkResults={benchmarkResults}
                                        savedBaselineResult={savedComparisonBaseline}
                                        savedComparisonResult={savedComparisonResult}
                                        onRerunSnapshot={handleRerunSnapshot}
                                        onCompareSavedRuns={handleCompareSavedRuns}
                                        onSelectGoldenDataset={handleSelectGoldenDataset}
                                        onClearBenchmarks={handleClearBenchmarks}
                                        rerunLoading={comparisonLoading}
                                        rerunError={comparisonError}
                                        savedCompareLoading={savedComparisonLoading}
                                        savedCompareError={savedComparisonError}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Idle state */}
                        {!result && !isAnalyzing && feed.length === 0 && !error && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <GlassCard className="text-center py-8">
                                    <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">Ready</p>
                                    <h2 className="text-2xl font-black mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                                        Geopolitical Sentiment → Trade Signal
                                    </h2>
                                    <p className="text-slate-500 text-sm max-w-md mx-auto">
                                        Fetches live headlines, runs local Ollama sentiment analysis with {activeModelLabel},
                                        generates BUY/SELL signals for {trackedSymbols.join(", ")} and tracks live paper P&L over time.
                                    </p>
                                    <p className="text-slate-600 text-xs mt-4">
                                        {config.auto_run_enabled ? `Auto-runs in ${mm}:${ss.toString().padStart(2, "0")}` : "Auto-run disabled in admin settings"}
                                    </p>
                                </GlassCard>
                            </motion.div>
                        )}

                        {/* Article Feed */}
                        {feed.length > 0 && (
                            <GlassCard className="!p-0 overflow-hidden">
                                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/40">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-300">Live Feed</span>
                                        {articleItems.length > 0 && (
                                            <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/20">
                                                {articleItems.length} articles
                                            </span>
                                        )}
                                    </div>
                                    {isAnalyzing && (
                                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            Running
                                        </span>
                                    )}
                                </div>
                                <div className="max-h-[520px] overflow-y-auto p-4">
                                    {isAnalyzing && (
                                        <div className="flex items-center gap-2 text-slate-700 text-xs font-mono py-1">
                                            <span>›</span><span className="animate-pulse">▋</span>
                                        </div>
                                    )}
                                    {[...feed].reverse().map((item, i) => {
                                        if (item.kind === "article") {
                                            return (
                                                <ArticleCard
                                                    key={i}
                                                    item={item}
                                                    expanded={expandedIdxs.has(item.idx)}
                                                    onToggle={() => toggleArticle(item.idx)}
                                                    result={result}
                                                />
                                            );
                                        }
                                        return (
                                            <div key={i} className="flex items-start gap-2 py-0.5 text-xs text-slate-500 font-mono">
                                                <span className="text-slate-700 shrink-0">›</span>
                                                <span>{item.message}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </GlassCard>
                        )}
                    </div>
                </div>
            </main>

            <footer className="mt-16 pb-8 text-center text-slate-700 text-xs">
                Educational use only · Not financial advice · Trading leveraged ETFs carries significant risk
            </footer>

            {selectedRecommendation && (
                <TradeExecutionModal
                    recommendation={selectedRecommendation}
                    trade={selectedTrade ?? null}
                    onClose={() => setSelectedRecommendation(null)}
                    onSave={saveTradeExecution}
                />
            )}
        </div>
    );
}
