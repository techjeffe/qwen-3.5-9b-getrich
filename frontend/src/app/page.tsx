"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Activity, WifiOff, ArrowRight, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Clock, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Types
import {
    FeedItem,
    PriceQuote,
    Prices,
    AnalysisResult,
    AnalysisSnapshotItem,
    AppConfig,
    PnLSummary,
    PnLTrade,
    OllamaStatus,
    Recommendation,
    SentimentEntry,
} from "@/lib/types/analysis";

// Constants
import {
    DEFAULT_APP_CONFIG,
    LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY,
    GOLDEN_DATASET_REQUEST_ID_KEY,
    ANALYSIS_STAGES,
    SIGNAL_RULES,
    UNDERLYING_PRICE_MAP,
    EXECUTION_SYMBOLS_BY_UNDERLYING,
} from "@/lib/constants/analysis";

// Utilities
import {
    clamp,
    estimateRunTiming,
    formatSignedScore,
    livePnl,
    paperPnlUsd,
    formatSignedUsd,
} from "@/lib/utils/timing";

import {
    formatSnapshotLabel,
    compactReasoning,
    formatTs,
    formatTime,
    inferArticleSymbol,
    getArticleAssessment,
    signalColor,
    signalBadge,
} from "@/lib/utils/formatters";

import {
    buildChangeDrivers,
    StageMetricsComparison,
    ComparisonResultsCard,
} from "@/lib/utils/comparison";

// Components
import SentimentTicker from "@/components/Dashboard/SentimentTicker";
import GlassCard from "@/components/Dashboard/GlassCard";
import PriceRow from "@/components/Dashboard/PriceRow";
import ArticleCard from "@/components/Dashboard/ArticleCard";
import RecommendationBadge from "@/components/Dashboard/RecommendationBadge";
import RecommendationTooltip from "@/components/Dashboard/RecommendationTooltip";
import SignalHero from "@/components/Dashboard/SignalHero";
import AnalysisStatusCard from "@/components/Dashboard/AnalysisStatusCard";
import PullHistoryCard from "@/components/Dashboard/PullHistoryCard";
import ModelComparePanel from "@/components/Dashboard/ModelComparePanel";
import DebugPanel from "@/components/Dashboard/DebugPanel";
import TradeExecutionModal from "@/components/Dashboard/TradeExecutionModal";
import TradeCard from "@/components/Dashboard/TradeCard";
import ActualTradeComparisonCard from "@/components/Dashboard/ActualTradeComparisonCard";
import { useTimezone } from "@/lib/timezone";

// ─── Helper Functions ─────────────────────────────────

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

// ─── Main Page ──────────────────────────────

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
    const pricePanelSymbols = useMemo(() => {
        const openTradeSymbols = (pnlSummary?.trades ?? [])
            .filter((t) => !t.trade_close)
            .map((t) => t.symbol);
        return Array.from(new Set([...trackedSymbols, ...openTradeSymbols]));
    }, [trackedSymbols, pnlSummary]);

    // Keep stable refs for the auto-run effect
    const isAnalyzingRef = useRef(false);
    useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);

    const handleAnalyzeRef = useRef<() => void>(() => {});
    const countdownRef = useRef(countdown);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const nextConfig = await response.json() as AppConfig;

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
                            if (analysisStartedAt) {
                                const completionSeconds = Math.round((Date.now() - analysisStartedAt) / 1000);
                                const storedTimes = localStorage.getItem("recentAnalysisTimes");
                                const recentTimes = storedTimes ? JSON.parse(storedTimes) : [];
                                const updatedTimes = [...recentTimes, completionSeconds].slice(-10);
                                localStorage.setItem("recentAnalysisTimes", JSON.stringify(updatedTimes));

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

    useEffect(() => { handleAnalyzeRef.current = handleAnalyze; }, [handleAnalyze]);
    useEffect(() => { countdownRef.current = countdown; }, [countdown]);

    // Auto-run countdown.
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
        const id = setInterval(fetchPrices, 300_000);
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