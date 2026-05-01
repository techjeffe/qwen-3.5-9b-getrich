// ─── Analysis Data Types ─────────────────────────────────────────────────────

// Feed items from the analysis stream
export type FeedItem =
    | { kind: "log"; message: string }
    | { kind: "article"; idx: number; source: string; title: string; description: string; keywords: string[] };

// Price quote for a symbol
export type PriceQuote = {
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

export type Prices = Record<string, PriceQuote>;

// Market validation metrics
export type MarketValidationMetric = {
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

export type MarketValidationPayload = {
    status: string;
    summary: string;
    metrics: MarketValidationMetric[];
    sources: string[];
    updated_at: string;
};

// Model input types
export type ModelInputArticle = {
    source: string;
    title: string;
    description: string;
    content?: string;
    keywords: string[];
};

export type ModelInputWebItem = {
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

export type ModelInputDebug = {
    news_context: string;
    validation_context: string;
    price_context: Record<string, number>;
    articles: ModelInputArticle[];
    per_symbol_prompts: Record<string, string>;
    web_context_by_symbol: Record<string, string>;
    web_items_by_symbol: Record<string, ModelInputWebItem[]>;
};

// Ingestion trace types
export type IngestionTraceArticle = {
    source: string;
    title: string;
    summary: string;
    content?: string;
    keywords: string[];
};

export type IngestionTrace = {
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

// Recommendation types
export type Recommendation = {
    action: "BUY" | "SELL";
    symbol: string;
    leverage: string;
    underlying_symbol?: string;
    thesis?: "LONG" | "SHORT";
};

// Red team review types
export type RedTeamSymbolReview = {
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

export type RedTeamReview = {
    summary: string;
    portfolio_risks: string[];
    source_bias_penalty_applied: boolean;
    source_bias_notes: string;
    symbol_reviews: RedTeamSymbolReview[];
};

export type RedTeamSignalChange = {
    symbol: string;
    blue_team_recommendation: string;
    consensus_recommendation: string;
    changed: boolean;
    change_type: string;
    rationale: string;
    evidence: string[];
};

export type RedTeamDebug = {
    context: Record<string, any>;
    prompt: string;
    raw_response: string;
    parsed_payload: Record<string, any>;
    signal_changes: RedTeamSignalChange[];
};

// Sentiment entry
export type SentimentEntry = {
    market_bluster: number;
    policy_change: number;
    confidence: number;
    reasoning: string;
};

// Actual execution and trade comparison
export type ActualExecution = {
    id: number;
    executed_action: "BUY" | "SELL";
    executed_price: number;
    executed_at: string;
    notes: string;
};

export type TradeComparison = {
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

export type TradeCloseRecord = {
    id: number;
    closed_price: number;
    closed_at: string;
    notes: string;
    closed_return_pct: number;
    paper_pnl_usd?: number;
    exec_closed_return_pct?: number | null;
    exec_paper_pnl_usd?: number | null;
};

// PnL trade types
export type PnLTrade = {
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

export type PnLSummary = {
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

// Ollama status
export type OllamaStatus = {
    reachable: boolean;
    ollama_root?: string;
    configured_model?: string;
    active_model?: string;
    available_models?: string[];
    resolution?: string;
    error?: string;
};

// Analysis stages
export type AnalysisStage = {
    key: string;
    label: string;
    weight: number;
    matches: string[];
};

// App config
export type AppConfig = {
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
    recent_analysis_seconds: number[];
    extraction_model?: string;
    reasoning_model?: string;
    rss_article_detail_mode?: "light" | "normal" | "detailed";
    risk_profile?: string;
};

// Analysis result
export type AnalysisResult = {
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

// Snapshot recommendation
export type SnapshotRecommendation = {
    action: string;
    symbol: string;
    leverage: string;
    underlying_symbol?: string;
};

// Analysis snapshot item
export type AnalysisSnapshotItem = {
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