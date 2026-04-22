"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, WifiOff, ArrowRight, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SentimentTicker from "@/components/Dashboard/SentimentTicker";
import RollingWindowChart from "@/components/Dashboard/RollingWindowChart";

// ─── Types ──────────────────────────────────────────────────────────────────

type FeedItem =
    | { kind: "log"; message: string }
    | { kind: "article"; idx: number; source: string; title: string; description: string; keywords: string[] };

type PriceQuote = { price: number; change: number; change_pct: number; day_low: number; day_high: number };
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
    keywords: string[];
};
type ModelInputDebug = {
    news_context: string;
    validation_context: string;
    price_context: Record<string, number>;
    articles: ModelInputArticle[];
    per_symbol_prompts: Record<string, string>;
};

type Recommendation = { action: "BUY" | "SELL"; symbol: string; leverage: string };
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
};
type PnLTrade = {
    id: number;
    request_id: string;
    symbol: string;
    action: "BUY" | "SELL";
    leverage: string;
    entry_price: number;
    actual_execution?: ActualExecution | null;
    comparison?: TradeComparison | null;
};
type PnLSummary = {
    execution_summary: {
        executed_trades: number;
        matched_recommendation: number;
        avg_latest_recommended_return_pct: number;
        avg_latest_actual_return_pct: number;
        match_rate: number;
    };
    trades: PnLTrade[];
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
    max_posts: number;
    include_backtest: boolean;
    lookback_days: number;
    symbol_prompt_overrides: Record<string, string>;
    last_analysis_started_at: string | null;
    last_analysis_completed_at: string | null;
    last_analysis_request_id: string | null;
    seconds_until_next_auto_run: number;
    can_auto_run_now: boolean;
    supported_symbols: string[];
    estimated_analysis_seconds: number;
    recent_analysis_seconds?: number[];
};
type AnalysisResult = {
    request_id: string;
    symbols_analyzed: string[];
    posts_scraped: number;
    sentiment_scores: Record<string, SentimentEntry>;
    aggregated_sentiment?: SentimentEntry | null;
    trading_signal?: any;
    market_validation: Record<string, MarketValidationPayload>;
    model_inputs?: ModelInputDebug | null;
    backtest_results?: any;
    processing_time_ms: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_APP_CONFIG: AppConfig = {
    auto_run_enabled: true,
    auto_run_interval_minutes: 30,
    tracked_symbols: ["USO", "BITO", "QQQ", "SPY"],
    max_posts: 50,
    include_backtest: true,
    lookback_days: 14,
    symbol_prompt_overrides: {},
    last_analysis_started_at: null,
    last_analysis_completed_at: null,
    last_analysis_request_id: null,
    seconds_until_next_auto_run: 0,
    can_auto_run_now: true,
    supported_symbols: ["BITO", "QQQ", "SPY", "SQQQ", "UNG", "USO"],
    estimated_analysis_seconds: 82,
    recent_analysis_seconds: [],
};
const ANALYSIS_STAGES: AnalysisStage[] = [
    { key: "preflight", label: "Checking model", weight: 0.08, matches: ["Ollama reachable"] },
    { key: "ingestion", label: "Collecting live feeds", weight: 0.24, matches: ["Fetching ", "articles", "Ingestion complete"] },
    { key: "prices", label: "Loading market prices", weight: 0.08, matches: ["Fetching real-time price data", "Price data fetched"] },
    { key: "sentiment", label: "Running symbol specialists", weight: 0.38, matches: ["Running Qwen", "bluster=", "confidence="] },
    { key: "signal", label: "Building trade signals", weight: 0.08, matches: ["Generating trading signal", "Signal: "] },
    { key: "backtest", label: "Running backtest", weight: 0.14, matches: ["Running rolling window backtest", "Backtest complete"] },
];
const SIGNAL_RULES = [
    { border: "border-l-red-500",     bg: "bg-red-500/5",     label: "SHORT", labelColor: "text-red-400",    desc: "Bluster < −0.5 & Policy < 0.3" },
    { border: "border-l-emerald-500", bg: "bg-emerald-500/5", label: "LONG",  labelColor: "text-emerald-400", desc: "Policy Change > 0.7" },
    { border: "border-l-slate-600",   bg: "bg-slate-800/30",  label: "HOLD",  labelColor: "text-slate-400",   desc: "Default Condition" },
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
    const up = q.change_pct >= 0;
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-slate-700/40 last:border-0">
            <span className="text-xs font-mono font-bold text-slate-300">{symbol}</span>
            <div className="text-right">
                <span className="text-xs font-mono text-white">${q.price.toFixed(2)}</span>
                <span className={`ml-2 text-[10px] font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>
                    {up ? "+" : ""}{q.change_pct.toFixed(2)}%
                </span>
            </div>
        </div>
    );
}

function ArticleCard({ item, expanded, onToggle, result }: {
    item: FeedItem & { kind: "article" };
    expanded: boolean;
    onToggle: () => void;
    result: any;
}) {
    const signal = result?.trading_signal;
    const signalColor = signal?.signal_type === "LONG" ? "text-emerald-400" :
        signal?.signal_type === "SHORT" ? "text-red-400" : "text-slate-500";
    const keywords = Array.from(
        new Set(item.keywords.map((keyword) => keyword.trim()).filter(Boolean))
    );

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
                            {result && (
                                <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-700/40">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Model Assessment</p>
                                    <p className={`text-xs font-semibold ${signalColor}`}>
                                        Signal: {signal?.signal_type ?? "—"}  ·  Confidence: {signal ? Math.round(signal.confidence_score * 100) : 0}%
                                    </p>
                                    {result.aggregated_sentiment?.reasoning && (
                                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                            {result.aggregated_sentiment.reasoning.slice(0, 200)}…
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
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-bold text-sm ${
            isBuy
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/15 border-red-500/30 text-red-300"
        } ${onClick ? "hover:bg-white/10 cursor-pointer" : "cursor-default"}`}>
            {isBuy ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{rec.action}</span>
            <span className="font-black">{rec.symbol}</span>
            <span className="font-mono text-xs opacity-70">{rec.leverage}</span>
            {hasExecution && <span className="text-[10px] uppercase opacity-80">Logged</span>}
        </button>
    );
}

function SignalHero({
    signal,
    sentimentScores,
    trackedSymbols,
    trackedTrades,
    onRecommendationClick,
}: {
    signal: any;
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
        (signal.recommendations ?? []).map((rec: Recommendation) => [rec.symbol, rec])
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
                            key={i}
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
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                        signal.urgency === "HIGH" ? "bg-red-500/10 border-red-500/20 text-red-400" :
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

            <div className="grid grid-cols-3 gap-2 mt-4">
                {[
                    { label: "Entry", val: signal.entry_symbol },
                    { label: "Stop Loss", val: `-${signal.stop_loss_pct}%`, cls: "text-red-400" },
                    { label: "Take Profit", val: `+${signal.take_profit_pct}%`, cls: "text-emerald-400" },
                ].map(({ label, val, cls }) => (
                    <div key={label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                        <p className={`text-sm font-bold ${cls ?? "text-white"}`}>{val}</p>
                    </div>
                ))}
            </div>

            {symbolWhyItems.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
                    {symbolWhyItems.map((item: { symbol: string; action: string; leverage: string; reasoning: string }) => {
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
                            <div key={item.symbol} className={`rounded-xl border p-4 ${tone}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-base font-black text-white">{item.symbol}</p>
                                    <p className={`text-sm font-semibold ${labelColor}`}>
                                        {item.action}{item.leverage ? ` ${item.leverage}` : ""}
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
}: {
    stageLabel: string;
    progressPct: number;
    elapsedSeconds: number;
    etaSeconds: number;
    latestMessage: string;
    isWaitingForStream: boolean;
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
                    <span>Elapsed {elapsed}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <motion.div
                        className="h-full bg-gradient-to-r from-yellow-400 to-emerald-400"
                        animate={{ width: `${isWaitingForStream ? 8 : Math.max(6, Math.min(progressPct, 96))}%` }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                </div>
            </div>
        </GlassCard>
    );
}

function AdvancedInputsPanel({
    result,
}: {
    result: AnalysisResult;
}) {
    const modelInputs = result.model_inputs;
    const validationEntries = Object.entries(result.market_validation ?? {});
    const visibleArticles = modelInputs?.articles ?? [];

    return (
        <GlassCard>
            <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                    <p className="text-[10px] text-blue-300 uppercase tracking-[0.24em]">Advanced Mode</p>
                    <h2 className="text-lg font-semibold text-white mt-1">Model Input Debug View</h2>
                </div>
                <div className="text-right text-xs text-slate-400">
                    <p>{visibleArticles.length} articles</p>
                    <p>{validationEntries.length} validation blocks</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="space-y-4">
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

                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Compiled News Context</p>
                        <pre className="max-h-80 overflow-auto text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                            {modelInputs?.news_context || "No compiled news context returned."}
                        </pre>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">RSS Articles Fed To The Model</p>
                        <div className="max-h-80 overflow-auto space-y-3">
                            {visibleArticles.length > 0 ? visibleArticles.map((article, index) => (
                                <div key={`${article.source}-${article.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-blue-300">{article.source}</p>
                                    <p className="text-sm text-white mt-1">{article.title}</p>
                                    {article.description && (
                                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">{article.description}</p>
                                    )}
                                    {article.keywords.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {article.keywords.map((keyword, keywordIndex) => (
                                                <span key={`${article.title}-${keyword}-${keywordIndex}`} className="text-[10px] rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-blue-200">
                                                    #{keyword}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )) : (
                                <p className="text-xs text-slate-500">No RSS/debug articles captured.</p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">FRED / EIA Validation Blocks</p>
                        <div className="space-y-3">
                            {validationEntries.map(([symbol, payload]) => (
                                <div key={symbol} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
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
                                                    <span className="font-mono text-white">
                                                        {metric.current ?? "n/a"}{metric.unit === "percent" ? "%" : ""}
                                                    </span>
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
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">Per-Symbol Final Prompts</p>
                        <div className="space-y-3">
                            {Object.entries(modelInputs?.per_symbol_prompts ?? {}).map(([symbol, prompt]) => (
                                <div key={symbol} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <p className="text-sm font-black text-white mb-2">{symbol}</p>
                                    <pre className="max-h-72 overflow-auto text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                                        {prompt}
                                    </pre>
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
                                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                                        executedAction === action
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

function ActualTradeComparisonCard({ pnlSummary, currentRequestId }: { pnlSummary: PnLSummary | null; currentRequestId?: string }) {
    const executedTrades = (pnlSummary?.trades ?? [])
        .filter((trade) => trade.actual_execution)
        .sort((a, b) => {
            const aTime = new Date(a.actual_execution?.executed_at || 0).getTime();
            const bTime = new Date(b.actual_execution?.executed_at || 0).getTime();
            return bTime - aTime;
        });
    const currentTrades = executedTrades.filter((trade) => trade.request_id === currentRequestId);
    const visibleTrades = (currentTrades.length > 0 ? currentTrades : executedTrades).slice(0, 6);

    if (!pnlSummary || visibleTrades.length === 0) return null;

    return (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    Your Trades vs Recommendations
                </h3>
                <span className="text-xs text-gray-500">
                    {currentTrades.length > 0
                        ? `${currentTrades.length} from this run`
                        : `Showing latest ${visibleTrades.length} logged trades`}
                </span>
            </div>

            <p className="text-sm text-gray-400 mb-4">
                Logged trades now stay visible across auto re-runs even after a new request id is created.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg bg-gray-700/50 p-4">
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Recommended Avg</p>
                    <p className={`text-2xl font-black ${pnlSummary.execution_summary.avg_latest_recommended_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pnlSummary.execution_summary.avg_latest_recommended_return_pct >= 0 ? "+" : ""}
                        {pnlSummary.execution_summary.avg_latest_recommended_return_pct.toFixed(2)}%
                    </p>
                </div>
                <div className="rounded-lg bg-gray-700/50 p-4">
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Your Actual Avg</p>
                    <p className={`text-2xl font-black ${pnlSummary.execution_summary.avg_latest_actual_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pnlSummary.execution_summary.avg_latest_actual_return_pct >= 0 ? "+" : ""}
                        {pnlSummary.execution_summary.avg_latest_actual_return_pct.toFixed(2)}%
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                {visibleTrades.map((trade) => (
                    <div key={trade.id} className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-black text-white">
                                {trade.symbol} · Recommended {trade.action} {trade.leverage}
                            </p>
                            <p className="text-xs text-gray-400">
                                You {trade.actual_execution?.executed_action} @ ${trade.actual_execution?.executed_price.toFixed(2)}
                            </p>
                        </div>
                        {trade.comparison ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-sm">
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Horizon</p>
                                    <p className="text-white">{trade.comparison.latest_horizon}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Recommended</p>
                                    <p className={trade.comparison.recommended_return_pct >= 0 ? "text-green-400" : "text-red-400"}>
                                        {trade.comparison.recommended_return_pct >= 0 ? "+" : ""}
                                        {trade.comparison.recommended_return_pct.toFixed(2)}%
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Your Trade</p>
                                    <p className={trade.comparison.actual_return_pct >= 0 ? "text-green-400" : "text-red-400"}>
                                        {trade.comparison.actual_return_pct >= 0 ? "+" : ""}
                                        {trade.comparison.actual_return_pct.toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 mt-3">Waiting for enough market history to compare this trade.</p>
                        )}
                    </div>
                ))}
            </div>
        </motion.div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
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
    const feedBottomRef = useRef<HTMLDivElement>(null);
    const articleCounter = useRef(0);
    const autoRunStartedRef = useRef(false);
    const trackedSymbols = config.tracked_symbols.length > 0 ? config.tracked_symbols : DEFAULT_APP_CONFIG.tracked_symbols;

    // Keep stable refs for the auto-run effect
    const isAnalyzingRef = useRef(false);
    useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const nextConfig = await response.json() as AppConfig;
            setConfig(nextConfig);
            setCountdown(nextConfig.seconds_until_next_auto_run);
            setConfigLoaded(true);
        } catch {}
    }, []);

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
        articleCounter.current = 0;

        try {
            const response = await fetch("/api/analyze/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbols: trackedSymbols,
                    max_posts: config.max_posts,
                    include_backtest: config.include_backtest,
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
    }, [config.include_backtest, config.lookback_days, config.max_posts, config.auto_run_interval_minutes, trackedSymbols, fetchConfig, streamStartedAt]);

    const fetchPnl = useCallback(async () => {
        try {
            const response = await fetch("/api/pnl", { cache: "no-store" });
            if (response.ok) {
                setPnlSummary(await response.json());
            }
        } catch {}
    }, []);

    useEffect(() => {
        const timerStart = streamStartedAt ?? analysisStartedAt;
        if (!isAnalyzing || !timerStart) return;
        const id = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - timerStart) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [isAnalyzing, analysisStartedAt, streamStartedAt]);

    // Auto-run countdown
    useEffect(() => {
        if (!configLoaded || !config.auto_run_enabled) return;
        const tick = setInterval(() => {
            if (isAnalyzingRef.current) return;
            setCountdown((c) => {
                if (c <= 1) { autoRunStartedRef.current = true; handleAnalyze(); return config.auto_run_interval_minutes * 60; }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(tick);
    }, [config.auto_run_enabled, config.auto_run_interval_minutes, configLoaded, handleAnalyze]);

    useEffect(() => {
        void fetchConfig();
    }, [fetchConfig]);

    useEffect(() => {
        if (!configLoaded || isAnalyzing || autoRunStartedRef.current) return;
        if (config.auto_run_enabled && config.can_auto_run_now && !result && feed.length === 0) {
            autoRunStartedRef.current = true;
            void handleAnalyze();
        }
    }, [config, configLoaded, feed.length, handleAnalyze, isAnalyzing, result]);

    // Price polling
    const fetchPrices = useCallback(async () => {
        try {
            const r = await fetch("/api/prices");
            if (r.ok) setPrices(await r.json());
        } catch {}
    }, []);

    useEffect(() => {
        fetchPrices();
        const id = setInterval(fetchPrices, 60_000);
        return () => clearInterval(id);
    }, [fetchPrices]);

    useEffect(() => {
        fetchPnl();
    }, [fetchPnl]);

    // Auto-scroll feed
    useEffect(() => {
        feedBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [feed]);

    const toggleArticle = (idx: number) => {
        setExpandedIdxs((prev) => {
            const next = new Set(prev);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return next;
        });
    };

    const isOllamaError = error?.toLowerCase().includes("ollama");
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
    const progressBase = ANALYSIS_STAGES
        .slice(0, stageIndex)
        .reduce((sum, stage) => sum + stage.weight, 0);
    const currentStageWeight = ANALYSIS_STAGES[stageIndex]?.weight ?? 0.1;
    const estimatedAnalysisSeconds = config.estimated_analysis_seconds || 82;
    const elapsedShare = Math.min(elapsedSeconds / estimatedAnalysisSeconds, 1);
    const stageDrift = Math.min(currentStageWeight * 0.65, elapsedShare * currentStageWeight);
    const progressPct = (progressBase + stageDrift) * 100;
    const stageEtaSeconds = Math.max(0, Math.round(estimatedAnalysisSeconds * (1 - Math.min(progressPct / 100, 0.95))));
    const rawEtaSeconds = Math.max(stageEtaSeconds, estimatedAnalysisSeconds - elapsedSeconds);
    const etaSeconds = isAnalyzing ? rawEtaSeconds : 0;
    const isWaitingForStream = isAnalyzing && !streamStartedAt;

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
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                            Sentiment Trading Alpha
                        </h1>
                        <p className="text-slate-500 text-xs mt-0.5">{trackedSymbols.join(" · ")} | Geopolitical Sentiment Pipeline</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {error && (
                            <span className="flex items-center gap-1.5 text-xs bg-red-500/10 text-red-400 px-3 py-1 rounded-full border border-red-500/20">
                                <WifiOff size={11} /> {isOllamaError ? "Ollama Unreachable" : "Error"}
                            </span>
                        )}
                        <div className="text-right">
                            <p className="text-[11px] text-slate-500">System Status</p>
                            <p className={`text-sm font-semibold ${isAnalyzing ? "text-yellow-400" : result ? "text-emerald-400" : "text-slate-400"}`}>
                                {isAnalyzing ? "Analyzing…" : result ? "Signal Ready" : "Idle"}
                            </p>
                        </div>
                        <Link href="/about" className="text-xs text-slate-300 hover:text-white border border-slate-700 rounded-lg px-3 py-2">
                            About
                        </Link>
                        <Link href="/admin" className="text-xs text-blue-300 hover:text-blue-200 border border-blue-500/20 rounded-lg px-3 py-2">
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
                                {[
                                    { label: "Model", val: "Qwen 3.5 9b", cls: "text-blue-300 font-mono text-xs" },
                                    { label: "Feeds", val: "7 RSS Sources", cls: "font-mono text-xs" },
                                    { label: "Symbols", val: trackedSymbols.join(", "), cls: "font-mono text-xs" },
                                    { label: "Leverage", val: "3×", cls: "text-orange-400 font-mono text-xs font-bold" },
                                ].map(({ label, val, cls }) => (
                                    <div key={label} className="flex justify-between border-b border-slate-700/40 pb-2 last:border-0">
                                        <span className="text-slate-400">{label}</span>
                                        <span className={cls}>{val}</span>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => setAdvancedMode((current) => !current)}
                                className={`w-full mb-3 py-2 rounded-xl font-semibold text-xs border transition-colors ${
                                    advancedMode
                                        ? "border-blue-400/40 bg-blue-500/10 text-blue-200"
                                        : "border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-800"
                                }`}
                            >
                                {advancedMode ? "Advanced Mode On" : "Advanced Mode Off"}
                            </button>
                            <button onClick={handleAnalyze} disabled={isAnalyzing}
                                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                                    isAnalyzing ? "bg-slate-700 cursor-not-allowed text-slate-400" : "bg-blue-600 hover:bg-blue-500 text-white"
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
                                    {Object.entries(prices).map(([sym, q]) => (
                                        <PriceRow key={sym} symbol={sym} q={q} />
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
                                                ollama run qwen3.5:9b
                                            </code>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Signal Hero (results) */}
                        <AnimatePresence>
                            {isAnalyzing && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                                    <AnalysisStatusCard
                                        stageLabel={stageLabel}
                                        progressPct={progressPct}
                                        elapsedSeconds={elapsedSeconds}
                                        etaSeconds={etaSeconds}
                                        latestMessage={latestLogMessage || "Waiting for the next pipeline update..."}
                                        isWaitingForStream={isWaitingForStream}
                                    />
                                </motion.div>
                            )}
                            {result && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                                    <SignalHero
                                        signal={result.trading_signal}
                                        sentimentScores={result.sentiment_scores}
                                        trackedSymbols={trackedSymbols}
                                        trackedTrades={currentRequestTrades}
                                        onRecommendationClick={setSelectedRecommendation}
                                    />
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                        <SentimentTicker data={result.sentiment_scores} />
                                        <RollingWindowChart backtestResults={result.backtest_results} lookbackDays={config.lookback_days} />
                                    </div>
                                    {advancedMode && <AdvancedInputsPanel result={result} />}
                                    <ActualTradeComparisonCard pnlSummary={pnlSummary} currentRequestId={result.request_id} />
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
                                        Fetches live headlines, runs Qwen 3.5 9b sentiment analysis,
                                        generates BUY/SELL signals for {trackedSymbols.join(", ")} — backtests on 6 months of data.
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
                                    {feed.map((item, i) => {
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
                                    {isAnalyzing && (
                                        <div className="flex items-center gap-2 text-slate-700 text-xs font-mono py-1">
                                            <span>›</span><span className="animate-pulse">▋</span>
                                        </div>
                                    )}
                                    <div ref={feedBottomRef} />
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
