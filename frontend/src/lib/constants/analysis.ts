// ─── Analysis Constants ─────────────────────────────────────────────────────

import { AppConfig } from "@/lib/types/analysis";

export const DEFAULT_APP_CONFIG: AppConfig = {
    auto_run_enabled: true,
    auto_run_interval_minutes: 30,
    tracked_symbols: ["USO", "IBIT", "QQQ", "SPY"],
    custom_symbols: [],
    default_symbols: ["USO", "IBIT", "QQQ", "SPY"],
    max_custom_symbols: 50,
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
    supported_symbols: ["USO", "IBIT", "QQQ", "SPY"],
    estimated_analysis_seconds: 82,
    recent_analysis_seconds: [],
    extraction_model: "",
    reasoning_model: "",
    rss_article_detail_mode: "normal",
    risk_profile: "moderate",
};

export const LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY = "lastViewedAnalysisRequestId";
export const GOLDEN_DATASET_REQUEST_ID_KEY = "goldenDatasetRequestId";

export const ANALYSIS_STAGES = [
    { key: "preflight", label: "Checking model", weight: 0.08, matches: ["Ollama reachable"] },
    { key: "ingestion", label: "Collecting live feeds", weight: 0.24, matches: ["Fetching ", "articles", "Ingestion complete"] },
    { key: "prices", label: "Loading market prices", weight: 0.08, matches: ["Fetching real-time price data", "Price data fetched"] },
    { key: "sentiment", label: "Running symbol specialists", weight: 0.38, matches: ["Running Qwen", "bluster=", "confidence="] },
    { key: "signal", label: "Building trade signals", weight: 0.22, matches: ["Generating trading signal", "Signal: "] },
];

export const SIGNAL_RULES = [
    { border: "border-l-red-500", bg: "bg-red-500/5", label: "SHORT", labelColor: "text-red-400", desc: "Bluster < −0.5 & Policy < 0.3" },
    { border: "border-l-emerald-500", bg: "bg-emerald-500/5", label: "LONG", labelColor: "text-emerald-400", desc: "Policy Change > 0.7" },
    { border: "border-l-slate-600", bg: "bg-slate-800/30", label: "HOLD", labelColor: "text-slate-400", desc: "Default Condition" },
];

// Maps leveraged/inverse execution tickers back to the underlying we have live prices for
export const UNDERLYING_PRICE_MAP: Record<string, string> = {
    QLD: "QQQ", QID: "QQQ", TQQQ: "QQQ", SQQQ: "QQQ",
    SSO: "SPY", SDS: "SPY", SPXL: "SPY", SPXS: "SPY",
    UCO: "USO", SCO: "USO",
    BITU: "IBIT", SBIT: "IBIT",
};

export const EXECUTION_SYMBOLS_BY_UNDERLYING: Record<string, string[]> = {
    QQQ: ["QQQ", "QLD", "QID", "TQQQ", "SQQQ"],
    SPY: ["SPY", "SSO", "SDS", "SPXL", "SPXS"],
    USO: ["USO", "UCO", "SCO"],
    IBIT: ["IBIT", "BITU", "SBIT"],
};