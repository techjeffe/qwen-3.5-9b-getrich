"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTs, useTimezone, COMMON_TIMEZONES } from "@/lib/timezone";

type RssFeedOption = {
    key: string;
    label: string;
    url: string;
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
    symbol_company_aliases: Record<string, string>;
    display_timezone: string;
    data_ingestion_interval_seconds: number;
    snapshot_retention_limit: number;
    extraction_model: string;
    reasoning_model: string;
    risk_profile: string;
    web_research_enabled: boolean;
    paper_trade_amount: number | null;
    entry_threshold: number | null;
    stop_loss_pct: number | null;
    take_profit_pct: number | null;
    materiality_min_posts_delta: number | null;
    materiality_min_sentiment_delta: number | null;
    logic_defaults: {
        paper_trade_amount: number;
        entry_threshold: number;
        stop_loss_pct: number;
        take_profit_pct: number;
        materiality_min_posts_delta: number;
        materiality_min_sentiment_delta: number;
    };
    available_models: string[];
    last_analysis_started_at: string | null;
    last_analysis_completed_at: string | null;
    last_analysis_request_id: string | null;
    seconds_until_next_auto_run: number;
    can_auto_run_now: boolean;
    supported_symbols: string[];
    default_rss_feeds: RssFeedOption[];
    custom_rss_feeds: string[];
    custom_rss_feed_labels: Record<string, string>;
    enabled_rss_feeds: string[];
    supported_rss_feeds: RssFeedOption[];
    max_custom_rss_feeds: number;
    rss_article_detail_mode: "light" | "normal" | "detailed";
    rss_article_limits: {
        light: number;
        normal: number;
        detailed: number;
    };
    rss_articles_per_feed: number;
    notices?: string[];
};

const EMPTY_CONFIG: AppConfig = {
    auto_run_enabled: true,
    auto_run_interval_minutes: 30,
    tracked_symbols: ["USO", "BITO", "QQQ", "SPY"],
    custom_symbols: [],
    default_symbols: ["USO", "BITO", "QQQ", "SPY"],
    max_custom_symbols: 3,
    max_posts: 50,
    lookback_days: 14,
    symbol_prompt_overrides: {},
    symbol_company_aliases: {},
    display_timezone: "",
    data_ingestion_interval_seconds: 900,
    snapshot_retention_limit: 12,
    extraction_model: "",
    reasoning_model: "",
    risk_profile: "moderate",
    web_research_enabled: false,
    paper_trade_amount: null,
    entry_threshold: null,
    stop_loss_pct: null,
    take_profit_pct: null,
    materiality_min_posts_delta: null,
    materiality_min_sentiment_delta: null,
    logic_defaults: {
        paper_trade_amount: 100,
        entry_threshold: 0.30,
        stop_loss_pct: 2.0,
        take_profit_pct: 3.0,
        materiality_min_posts_delta: 6,
        materiality_min_sentiment_delta: 0.24,
    },
    available_models: [],
    last_analysis_started_at: null,
    last_analysis_completed_at: null,
    last_analysis_request_id: null,
    seconds_until_next_auto_run: 0,
    can_auto_run_now: true,
    supported_symbols: ["USO", "BITO", "QQQ", "SPY"],
    default_rss_feeds: [],
    custom_rss_feeds: [],
    custom_rss_feed_labels: {},
    enabled_rss_feeds: [],
    supported_rss_feeds: [],
    max_custom_rss_feeds: 3,
    rss_article_detail_mode: "normal",
    rss_article_limits: { light: 5, normal: 15, detailed: 25 },
    rss_articles_per_feed: 15,
};

type UnexecutedTrade = {
    id: number;
    symbol: string;
    action: string;
    leverage: string;
    entry_price: number;
    recommended_at: string;
    request_id: string;
};

function normalizeSymbolInput(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10);
}

function normalizeFeedUrl(value: string) {
    return value.trim();
}

function normalizeArticleLimit(value: string, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(50, Math.round(parsed)));
}

export default function AdminPage() {
    const router = useRouter();
    const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
    const [savedConfig, setSavedConfig] = useState<AppConfig>(EMPTY_CONFIG);
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState<string>("");
    const [unexecutedTrades, setUnexecutedTrades] = useState<UnexecutedTrade[]>([]);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [deleteError, setDeleteError] = useState<string>("");
    const [showDirtyModal, setShowDirtyModal] = useState(false);
    const [pendingNav, setPendingNav] = useState<string | null>(null);
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetConfirmText, setResetConfirmText] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetStatus, setResetStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [isPulling, setIsPulling] = useState(false);
    const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [priceHistoryStatus, setPriceHistoryStatus] = useState<{
        symbols: Record<string, { rows: number; earliest_date: string | null; latest_date: string | null; ready: boolean }>;
        total_rows: number;
        all_ready: boolean;
    } | null>(null);
    const { timeZone, storedRaw, setTimeZone } = useTimezone();

    const isDirty = useMemo(
        () => JSON.stringify(config) !== JSON.stringify(savedConfig),
        [config, savedConfig]
    );

    const trackedSet = useMemo(() => new Set(config.tracked_symbols), [config.tracked_symbols]);
    const enabledFeeds = useMemo(() => new Set(config.enabled_rss_feeds), [config.enabled_rss_feeds]);
    const customSymbolSlots = Array.from({ length: config.max_custom_symbols }, (_, index) => config.custom_symbols[index] ?? "");
    const customFeedSlots = Array.from({ length: config.max_custom_rss_feeds }, (_, index) => {
        const url = config.custom_rss_feeds[index] ?? "";
        return {
            url,
            label: url ? (config.custom_rss_feed_labels[url] ?? "") : "",
        };
    });
    const depthOptions: Array<{
        key: AppConfig["rss_article_detail_mode"];
        label: string;
        tagline: string;
        pipeline: string;
        articles: string;
    }> = [
        {
            key: "light",
            label: "Light",
            tagline: "Fast single-model run",
            pipeline: "One model handles both entity mapping and reasoning — fastest turnaround.",
            articles: "5 articles per feed",
        },
        {
            key: "normal",
            label: "Normal",
            tagline: "Balanced, configurable",
            pipeline: "Optionally split entity mapping and reasoning across two models. Falls back to single-model if only one is configured.",
            articles: "15 articles per feed",
        },
        {
            key: "detailed",
            label: "Detailed",
            tagline: "Full two-model pipeline",
            pipeline: "Always runs Stage 1 entity mapping then Stage 2 reasoning. Requires both models to be set.",
            articles: "25 articles per feed",
        },
    ];
    const jumpOptions = [
        { value: "symbols", label: "Symbols" },
        { value: "rss", label: "RSS Sources" },
        { value: "prompts", label: "Prompt Overrides" },
        { value: "executions", label: "Manage Executions" },
        { value: "models", label: "Model Orchestration" },
        { value: "system", label: "Scheduling & System" },
    ];
    const riskOptions: Array<{
        key: string;
        label: string;
        tagline: string;
        description: string;
        maxLeverage: string;
        color: string;
    }> = [
        {
            key: "conservative",
            label: "Conservative",
            tagline: "1x, inverse ETFs for bearish",
            description: "Bullish signals buy the underlying at 1x. Bearish signals use the inverse ETF (e.g. SQQQ) at 1x position sizing — no shorting, no leverage amplification.",
            maxLeverage: "1x position, inverse ETFs allowed",
            color: "blue",
        },
        {
            key: "moderate",
            label: "Moderate",
            tagline: "2x when confident",
            description: "Use 2x leverage when model confidence exceeds 75%, otherwise 1x. Default setting.",
            maxLeverage: "2x at >75% confidence",
            color: "teal",
        },
        {
            key: "aggressive",
            label: "Aggressive",
            tagline: "3x when confident",
            description: "Use 3x leverage when model confidence exceeds 75%, otherwise 1x.",
            maxLeverage: "3x at >75% confidence",
            color: "amber",
        },
        {
            key: "crazy",
            label: "Crazy",
            tagline: "3x always",
            description: "Maximum leverage on every recommendation regardless of confidence. Not for the faint-hearted.",
            maxLeverage: "3x always",
            color: "rose",
        },
    ];

    const fetchUnexecuted = useCallback(async () => {
        const res = await fetch("/api/pnl", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const trades: UnexecutedTrade[] = (data.trades ?? [])
            .filter((t: any) => !!t.actual_execution)
            .map((t: any) => ({
                id: t.id,
                symbol: t.symbol,
                action: t.action,
                leverage: t.leverage,
                entry_price: t.entry_price,
                recommended_at: t.recommended_at,
                request_id: t.request_id,
            }));
        setUnexecutedTrades(trades);
    }, []);

    const fetchPriceHistoryStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/price-history/status", { cache: "no-store" });
            if (res.ok) setPriceHistoryStatus(await res.json());
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        const load = async () => {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const nextConfig = await response.json();
            if (!Array.isArray(nextConfig.available_models)) nextConfig.available_models = [];
            setConfig(nextConfig);
            setSavedConfig(nextConfig);
            setTimeZone(nextConfig.display_timezone || "");
        };
        void load();
        void fetchUnexecuted();
        void fetchPriceHistoryStatus();
    }, [fetchUnexecuted, fetchPriceHistoryStatus]);

    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [isDirty]);

    const toggleTrackedSymbol = (symbol: string) => {
        setConfig((current) => {
            const next = new Set(current.tracked_symbols);
            if (next.has(symbol)) {
                next.delete(symbol);
            } else {
                next.add(symbol);
            }
            return {
                ...current,
                tracked_symbols: Array.from(next),
            };
        });
    };

    const updateCustomSymbol = (index: number, value: string) => {
        const nextValue = normalizeSymbolInput(value);
        setConfig((current) => {
            const nextCustomSymbols = [...current.custom_symbols];
            const previousValue = nextCustomSymbols[index] ?? "";
            const nextAliases = { ...current.symbol_company_aliases };
            const previousAlias = previousValue ? (nextAliases[previousValue] ?? "") : "";
            if (nextValue) {
                nextCustomSymbols[index] = nextValue;
            } else {
                nextCustomSymbols.splice(index, 1);
            }
            const filteredCustomSymbols = nextCustomSymbols.filter(Boolean).slice(0, current.max_custom_symbols);
            if (previousValue && previousValue !== nextValue) {
                delete nextAliases[previousValue];
            }
            if (nextValue && previousAlias) {
                nextAliases[nextValue] = previousAlias;
            }
            const filteredAliases = Object.fromEntries(
                Object.entries(nextAliases).filter(([symbol, alias]) => filteredCustomSymbols.includes(symbol) && !!alias.trim())
            );
            const nextTracked = current.tracked_symbols
                .filter((symbol) => symbol !== previousValue)
                .filter((symbol) => current.default_symbols.includes(symbol) || filteredCustomSymbols.includes(symbol));
            if (nextValue && !nextTracked.includes(nextValue)) {
                nextTracked.push(nextValue);
            }
            return {
                ...current,
                custom_symbols: filteredCustomSymbols,
                symbol_company_aliases: filteredAliases,
                tracked_symbols: nextTracked,
            };
        });
    };

    const updateCustomSymbolAlias = (symbol: string, value: string) => {
        const trimmed = value.trimStart().slice(0, 120);
        setConfig((current) => {
            if (!symbol) return current;
            const nextAliases = { ...current.symbol_company_aliases };
            if (trimmed) {
                nextAliases[symbol] = trimmed;
            } else {
                delete nextAliases[symbol];
            }
            return {
                ...current,
                symbol_company_aliases: nextAliases,
            };
        });
    };

    const toggleCustomSymbolTracked = (symbol: string) => {
        if (!symbol) return;
        toggleTrackedSymbol(symbol);
    };

    const toggleFeed = (url: string) => {
        setConfig((current) => {
            const next = new Set(current.enabled_rss_feeds);
            if (next.has(url)) {
                next.delete(url);
            } else {
                next.add(url);
            }
            return {
                ...current,
                enabled_rss_feeds: Array.from(next),
            };
        });
    };

    const updateCustomFeed = (index: number, value: string) => {
        const nextValue = normalizeFeedUrl(value);
        setConfig((current) => {
            const nextCustomFeeds = [...current.custom_rss_feeds];
            const previousValue = nextCustomFeeds[index] ?? "";
            const nextFeedLabels = { ...current.custom_rss_feed_labels };
            const previousLabel = previousValue ? (nextFeedLabels[previousValue] ?? "") : "";
            if (nextValue) {
                nextCustomFeeds[index] = nextValue;
            } else {
                nextCustomFeeds.splice(index, 1);
            }
            const filteredCustomFeeds = nextCustomFeeds.filter(Boolean).slice(0, current.max_custom_rss_feeds);
            if (previousValue && previousValue !== nextValue) {
                delete nextFeedLabels[previousValue];
            }
            if (nextValue && previousLabel) {
                nextFeedLabels[nextValue] = previousLabel;
            }
            const filteredCustomFeedLabels = Object.fromEntries(
                Object.entries(nextFeedLabels).filter(([url, label]) => filteredCustomFeeds.includes(url) && !!label.trim())
            );
            const nextEnabled = current.enabled_rss_feeds
                .filter((url) => url !== previousValue)
                .filter((url) => current.default_rss_feeds.some((feed) => feed.url === url) || filteredCustomFeeds.includes(url));
            return {
                ...current,
                custom_rss_feeds: filteredCustomFeeds,
                custom_rss_feed_labels: filteredCustomFeedLabels,
                enabled_rss_feeds: nextEnabled,
            };
        });
    };

    const updateCustomFeedLabel = (url: string, value: string) => {
        const trimmed = value.trimStart().slice(0, 60);
        setConfig((current) => {
            if (!url) return current;
            const nextLabels = { ...current.custom_rss_feed_labels };
            if (trimmed) {
                nextLabels[url] = trimmed;
            } else {
                delete nextLabels[url];
            }
            return {
                ...current,
                custom_rss_feed_labels: nextLabels,
            };
        });
    };

    const toggleCustomFeedTracked = (url: string) => {
        if (!url) return;
        toggleFeed(url);
    };

    const updateArticleLimit = (key: "light" | "normal" | "detailed", value: string) => {
        setConfig((current) => ({
            ...current,
            rss_article_limits: {
                ...current.rss_article_limits,
                [key]: normalizeArticleLimit(value, current.rss_article_limits[key]),
            },
        }));
    };

    const updatePromptOverride = (symbol: string, value: string) => {
        setConfig((current) => ({
            ...current,
            symbol_prompt_overrides: {
                ...current.symbol_prompt_overrides,
                [symbol]: value,
            },
        }));
    };

    const deleteTrade = async (id: number) => {
        setDeletingId(id);
        setDeleteError("");
        try {
            const res = await fetch(`/api/trades/${id}/execution`, { method: "DELETE" });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                setDeleteError(payload?.error || "Remove failed");
                return;
            }
            await fetchUnexecuted();
        } finally {
            setDeletingId(null);
        }
    };

    const save = async () => {
        if (config.tracked_symbols.length === 0) {
            setStatus("Select at least one symbol");
            return;
        }
        if (config.enabled_rss_feeds.length === 0) {
            setStatus("Select at least one RSS feed");
            return;
        }

        setIsSaving(true);
        setStatus("");
        try {
            const response = await fetch("/api/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!response.ok) {
                throw new Error("Failed to save config");
            }
            const committed = await response.json();
            if (!Array.isArray(committed.available_models)) committed.available_models = [];
            setConfig(committed);
            setSavedConfig(committed);
            const notices = Array.isArray(committed.notices) ? committed.notices.filter(Boolean) : [];
            setStatus(notices.length > 0 ? `Saved. ${notices.join(" ")}` : "Saved");
        } catch {
            setStatus("Save failed");
        } finally {
            setIsSaving(false);
        }
    };

    const jumpToSection = (sectionId: string) => {
        if (!sectionId) return;
        const el = document.getElementById(sectionId);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const handleNavigate = (target: string) => {
        if (isDirty) {
            setPendingNav(target);
            setShowDirtyModal(true);
        } else {
            router.push(target);
        }
    };

    const handlePullPriceHistory = async () => {
        setIsPulling(true);
        setPullStatus(null);
        try {
            const res = await fetch("/api/admin/price-history/pull", { method: "POST" });
            const data = await res.json();
            if (!res.ok) {
                setPullStatus({ ok: false, message: data?.error || "Pull failed" });
                return;
            }
            const added = data.total_rows_added ?? 0;
            const limited = data.rate_limited ? " Rate limit hit — run again later to resume." : "";
            setPullStatus({ ok: !data.rate_limited, message: `${added} rows added.${limited}` });
            await fetchPriceHistoryStatus();
        } catch {
            setPullStatus({ ok: false, message: "Network error — pull may not have completed" });
        } finally {
            setIsPulling(false);
        }
    };

    const handleResetDatabase = async () => {
        setIsResetting(true);
        setResetStatus(null);
        try {
            const res = await fetch("/api/admin/reset", { method: "POST" });
            const data = await res.json();
            if (!res.ok) {
                setResetStatus({ ok: false, message: data?.error || "Reset failed" });
                return;
            }
            setResetStatus({ ok: true, message: `Cleared ${data.total_rows_deleted} rows across ${Object.keys(data.deleted).length} tables.` });
            setResetConfirmText("");
            // Refresh config timestamps
            const cfgRes = await fetch("/api/config", { cache: "no-store" });
            if (cfgRes.ok) {
                const nextConfig = await cfgRes.json();
                if (!Array.isArray(nextConfig.available_models)) nextConfig.available_models = [];
                setConfig(nextConfig);
                setSavedConfig(nextConfig);
            }
        } catch {
            setResetStatus({ ok: false, message: "Network error — reset may not have completed" });
        } finally {
            setIsResetting(false);
        }
    };

    const handleDiscardAndLeave = () => {
        setShowDirtyModal(false);
        router.push(pendingNav!);
    };

    const handleSaveAndLeave = async () => {
        await save();
        setShowDirtyModal(false);
        router.push(pendingNav!);
    };

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
            {showResetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl border border-red-800 bg-slate-900 p-6 space-y-4 shadow-2xl">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-red-600/20 flex items-center justify-center">
                                <span className="text-red-400 text-xs font-bold">!</span>
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-white">Reset all data?</h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    This permanently deletes all analysis results, trade recommendations, P&amp;L snapshots, and execution records.
                                    Your config settings are preserved. This cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-2">
                                Type <span className="font-mono text-red-400">RESET</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={resetConfirmText}
                                onChange={(e) => setResetConfirmText(e.target.value)}
                                placeholder="RESET"
                                autoFocus
                                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono text-white outline-none focus:border-red-500 placeholder:text-slate-600"
                            />
                        </div>
                        {resetStatus && (
                            <p className={`text-xs ${resetStatus.ok ? "text-emerald-400" : "text-red-400"}`}>
                                {resetStatus.message}
                            </p>
                        )}
                        <div className="flex gap-3 justify-end pt-1">
                            <button
                                type="button"
                                onClick={() => { setShowResetModal(false); setResetConfirmText(""); setResetStatus(null); }}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleResetDatabase}
                                disabled={resetConfirmText !== "RESET" || isResetting}
                                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isResetting ? "Resetting..." : "Reset Database"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showDirtyModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl">
                        <h2 className="text-base font-semibold text-white">Unsaved changes</h2>
                        <p className="text-sm text-slate-400">You have unsaved changes. Save before leaving?</p>
                        <div className="flex gap-3 justify-end pt-1">
                            <button
                                type="button"
                                onClick={() => setShowDirtyModal(false)}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                            >
                                Keep editing
                            </button>
                            <button
                                type="button"
                                onClick={handleDiscardAndLeave}
                                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:text-white"
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveAndLeave}
                                disabled={isSaving}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                                {isSaving ? "Saving..." : "Save & Leave"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Admin</p>
                        <h1 className="text-3xl font-black mt-2">Runtime Config</h1>
                        <p className="text-sm text-slate-400 mt-2">
                            Control autorun cadence, tracked symbols, RSS sources, and specialist prompt guidance.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => handleNavigate("/")}
                        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white"
                    >
                        Back
                    </button>
                </div>

                <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                        <label className="block">
                            <span className="text-xs text-slate-400">Jump to section</span>
                            <select
                                defaultValue=""
                                onChange={(e) => {
                                    jumpToSection(e.target.value);
                                    e.currentTarget.value = "";
                                }}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            >
                                <option value="">Choose a section…</option>
                                {jumpOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 min-w-[160px]">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Active depth</p>
                            <p className="mt-1.5 font-semibold text-slate-200">{depthOptions.find(o => o.key === config.rss_article_detail_mode)?.label ?? "Normal"}</p>
                            <p className="mt-0.5 text-slate-500">{depthOptions.find(o => o.key === config.rss_article_detail_mode)?.articles}</p>
                        </div>
                    </div>

                    <div>
                        <p className="text-xs text-slate-400 mb-3">Analysis depth &amp; pipeline mode</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {depthOptions.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setConfig((c) => ({ ...c, rss_article_detail_mode: option.key }))}
                                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                        config.rss_article_detail_mode === option.key
                                            ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                            : "border-slate-800 bg-slate-950/60 text-slate-300"
                                    }`}
                                >
                                    <p className="text-sm font-semibold">{option.label}</p>
                                    <p className="mt-0.5 text-[11px] text-slate-400 font-medium">{option.tagline}</p>
                                    <p className="mt-1.5 text-[11px] text-slate-500">{option.pipeline}</p>
                                    <p className="mt-2 text-[10px] font-mono text-slate-600">{option.articles}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className="text-xs text-slate-400 mb-3">Risk profile &amp; leverage</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {riskOptions.map((option) => {
                                const isActive = (config.risk_profile || "aggressive") === option.key;
                                const activeStyles: Record<string, string> = {
                                    blue: "border-blue-400 bg-blue-500/10 text-blue-100",
                                    teal: "border-teal-400 bg-teal-500/10 text-teal-100",
                                    amber: "border-amber-400 bg-amber-500/10 text-amber-100",
                                    rose: "border-rose-400 bg-rose-500/10 text-rose-100",
                                };
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => setConfig((c) => ({ ...c, risk_profile: option.key }))}
                                        className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                            isActive
                                                ? activeStyles[option.color]
                                                : "border-slate-800 bg-slate-950/60 text-slate-300"
                                        }`}
                                    >
                                        <p className="text-sm font-semibold">{option.label}</p>
                                        <p className="mt-0.5 text-[11px] text-slate-400 font-medium">{option.tagline}</p>
                                        <p className="mt-1.5 text-[11px] text-slate-500">{option.description}</p>
                                        <p className="mt-2 text-[10px] font-mono text-slate-600">{option.maxLeverage}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </section>

                <section id="models" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-200">Model Orchestration</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Model selection follows the depth setting chosen above.
                        </p>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.web_research_enabled}
                                onChange={(e) => setConfig((current) => ({ ...current, web_research_enabled: e.target.checked }))}
                                className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="block">
                                <span className="text-sm font-semibold text-slate-200">Light Web Research</span>
                                <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                                    Fetch up to a few recent trusted web headlines per active symbol and inject them into the specialist prompt.
                                    This is intentionally lightweight and meant for custom names like `NVDA` without pulling a huge feed universe.
                                </span>
                                <span className="block mt-2 text-[11px] text-slate-500">
                                    Snapshot reruns reuse the saved web context so model comparisons stay fair.
                                </span>
                            </span>
                        </label>
                    </div>

                    {config.available_models.length === 0 ? (
                        <p className="text-xs text-amber-400 italic">No Ollama models detected — make sure Ollama is running.</p>
                    ) : config.rss_article_detail_mode === "light" ? (
                        /* Light — one model for both stages */
                        <div className="space-y-3">
                            <p className="text-xs text-slate-400">
                                Light mode uses a single model for both entity mapping (Stage 1) and financial reasoning (Stage 2).
                                Pick a fast, small model for best throughput.
                            </p>
                            <label className="block">
                                <span className="text-xs text-slate-400">Analysis Model</span>
                                <select
                                    value={config.extraction_model}
                                    onChange={(e) => setConfig((c) => ({ ...c, extraction_model: e.target.value, reasoning_model: "" }))}
                                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                >
                                    <option value="">— use active Ollama model —</option>
                                    {config.available_models.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </label>
                            {config.extraction_model && (
                                <div className="rounded-xl border border-slate-700/50 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 space-y-0.5">
                                    <p><span className="text-slate-500">Stage 1 (entity mapping) — </span>{config.extraction_model}</p>
                                    <p><span className="text-slate-500">Stage 2 (reasoning) — </span>{config.extraction_model}</p>
                                </div>
                            )}
                        </div>
                    ) : config.rss_article_detail_mode === "detailed" ? (
                        /* Detailed — two models required */
                        <div className="space-y-4">
                            <p className="text-xs text-slate-400">
                                Detailed mode always runs the full two-stage pipeline. Both models are required.
                                Use a fast small model for Stage 1 and your best reasoning model for Stage 2.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <label className="block">
                                    <span className="text-xs text-slate-400">
                                        Stage 1 — Extraction Model
                                        {!config.extraction_model && <span className="ml-2 text-amber-400">required</span>}
                                    </span>
                                    <p className="text-[11px] text-slate-600 mt-0.5">Entity mapping &amp; article filtering (e.g. llama3.2:3b)</p>
                                    <select
                                        value={config.extraction_model}
                                        onChange={(e) => setConfig((c) => ({ ...c, extraction_model: e.target.value }))}
                                        className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none focus:border-blue-400 bg-slate-800 ${!config.extraction_model ? "border-amber-700/60" : "border-slate-700"}`}
                                    >
                                        <option value="">— choose a model —</option>
                                        {config.available_models.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-xs text-slate-400">
                                        Stage 2 — Reasoning Model
                                        {!config.reasoning_model && <span className="ml-2 text-amber-400">required</span>}
                                    </span>
                                    <p className="text-[11px] text-slate-600 mt-0.5">Financial signal generation (e.g. qwen3:9b)</p>
                                    <select
                                        value={config.reasoning_model}
                                        onChange={(e) => setConfig((c) => ({ ...c, reasoning_model: e.target.value }))}
                                        className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none focus:border-blue-400 bg-slate-800 ${!config.reasoning_model ? "border-amber-700/60" : "border-slate-700"}`}
                                    >
                                        <option value="">— choose a model —</option>
                                        {config.available_models.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {config.extraction_model && config.reasoning_model && (
                                <div className="rounded-xl border border-blue-800/40 bg-blue-500/5 px-4 py-3 text-xs text-slate-300 space-y-0.5">
                                    <p className="font-semibold text-blue-300 mb-1">Two-stage pipeline ready</p>
                                    <p><span className="text-slate-500">Stage 1 — </span>{config.extraction_model}</p>
                                    <p><span className="text-slate-500">Stage 2 — </span>{config.reasoning_model}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Normal — two models optional */
                        <div className="space-y-4">
                            <p className="text-xs text-slate-400">
                                Normal mode runs two-stage when both models are set, single-stage otherwise.
                                Leave blank to use whichever Ollama model is currently active.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <label className="block">
                                    <span className="text-xs text-slate-400">Stage 1 — Extraction Model <span className="text-slate-600">(optional)</span></span>
                                    <p className="text-[11px] text-slate-600 mt-0.5">Entity mapping &amp; article filtering (e.g. llama3.2:3b)</p>
                                    <select
                                        value={config.extraction_model}
                                        onChange={(e) => setConfig((c) => ({ ...c, extraction_model: e.target.value }))}
                                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                    >
                                        <option value="">— use active Ollama model —</option>
                                        {config.available_models.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-xs text-slate-400">Stage 2 — Reasoning Model <span className="text-slate-600">(optional)</span></span>
                                    <p className="text-[11px] text-slate-600 mt-0.5">Financial signal generation (e.g. qwen3:9b)</p>
                                    <select
                                        value={config.reasoning_model}
                                        onChange={(e) => setConfig((c) => ({ ...c, reasoning_model: e.target.value }))}
                                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                    >
                                        <option value="">— use active Ollama model —</option>
                                        {config.available_models.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {(config.extraction_model || config.reasoning_model) && (
                                <div className="rounded-xl border border-slate-700/50 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 space-y-0.5">
                                    {config.extraction_model && config.reasoning_model ? (
                                        <>
                                            <p className="font-semibold text-blue-300 mb-1">Two-stage pipeline active</p>
                                            <p><span className="text-slate-500">Stage 1 — </span>{config.extraction_model}</p>
                                            <p><span className="text-slate-500">Stage 2 — </span>{config.reasoning_model}</p>
                                        </>
                                    ) : (
                                        <p className="text-amber-400">Single-stage mode — set both models to enable two-stage pipeline.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </section>

                <section id="symbols" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <h2 className="text-sm font-semibold text-slate-200">Symbols</h2>

                    <div className="space-y-3">
                        <p className="text-xs text-slate-400">Active evaluation symbols</p>
                        <div className="flex flex-wrap gap-2">
                            {config.tracked_symbols.map((symbol) => (
                                <span
                                    key={`active-symbol-${symbol}`}
                                    className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-mono text-blue-200"
                                >
                                    {symbol}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-xs text-slate-400">Default symbols</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {config.default_symbols.map((symbol) => (
                                <label key={symbol} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
                                    <span className="font-mono">{symbol}</span>
                                    <input
                                        type="checkbox"
                                        checked={trackedSet.has(symbol)}
                                        onChange={() => toggleTrackedSymbol(symbol)}
                                    />
                                </label>
                            ))}
                        </div>
                        <p className="text-xs text-slate-500">
                            Unchecked symbols stay available here, but the model will skip them on future runs.
                        </p>
                    </div>

                    <div className="space-y-3">
                        <p className="text-xs text-slate-400">Custom symbols for evaluation and testing</p>
                        <div className="space-y-3">
                            {customSymbolSlots.map((symbol, index) => (
                                <div key={`custom-symbol-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 items-end">
                                        <label className="block">
                                            <span className="text-xs text-slate-400">Ticker</span>
                                            <input
                                                type="text"
                                                value={symbol}
                                                onChange={(e) => updateCustomSymbol(index, e.target.value)}
                                                placeholder={`Custom symbol ${index + 1}`}
                                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono uppercase"
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs text-slate-400">Company / entity alias</span>
                                            <input
                                                type="text"
                                                value={symbol ? (config.symbol_company_aliases[symbol] ?? "") : ""}
                                                onChange={(e) => updateCustomSymbolAlias(symbol, e.target.value)}
                                                placeholder="NVIDIA, ServiceNow, Oracle..."
                                                disabled={!symbol}
                                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
                                            />
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-slate-300 md:pb-2">
                                            <input
                                                type="checkbox"
                                                checked={!!symbol && trackedSet.has(symbol)}
                                                disabled={!symbol}
                                                onChange={() => toggleCustomSymbolTracked(symbol)}
                                            />
                                            Include in analysis
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-slate-500">
                            Entering a custom symbol adds it to the evaluation list automatically. Uncheck it if you want to keep it saved but inactive. The alias helps web research find fresher company-specific coverage.
                        </p>
                    </div>
                </section>

                <section id="rss" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-200">RSS Sources</h2>
                        <span className="text-xs text-slate-500 font-mono">
                            {config.rss_article_limits[config.rss_article_detail_mode]} articles/feed · {depthOptions.find(o => o.key === config.rss_article_detail_mode)?.label}
                        </span>
                    </div>

                    <div className="space-y-3">
                        <p className="text-xs text-slate-400">Default RSS feeds</p>
                        <div className="space-y-2">
                            {config.default_rss_feeds.map((feed) => (
                                <label key={feed.url} className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
                                    <div>
                                        <p className="text-slate-100">{feed.label}</p>
                                        <p className="text-xs text-slate-500 break-all">{feed.url}</p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={enabledFeeds.has(feed.url)}
                                        onChange={() => toggleFeed(feed.url)}
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-xs text-slate-400">Custom RSS feeds</p>
                        <div className="space-y-3">
                            {customFeedSlots.map(({ url, label }, index) => (
                                <div key={`custom-feed-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
                                        <label className="block">
                                            <span className="text-xs text-slate-400">Feed name</span>
                                            <input
                                                type="text"
                                                value={label}
                                                onChange={(e) => updateCustomFeedLabel(url, e.target.value)}
                                                placeholder={`Custom feed ${index + 1}`}
                                                disabled={!url}
                                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs text-slate-400">Feed URL</span>
                                            <input
                                                type="url"
                                                value={url}
                                                onChange={(e) => updateCustomFeed(index, e.target.value)}
                                                placeholder={`https://example.com/feed-${index + 1}.xml`}
                                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                                            />
                                        </label>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={!!url && enabledFeeds.has(url)}
                                            disabled={!url}
                                            onChange={() => toggleCustomFeedTracked(url)}
                                        />
                                        Include in analysis
                                    </label>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-slate-500">
                            Add up to {config.max_custom_rss_feeds} extra feeds for targeted sources like tech news, and give them friendly names that appear across the app.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="block">
                            <span className="text-xs text-slate-400">Overall post cap</span>
                            <input
                                type="number"
                                min={1}
                                max={200}
                                value={config.max_posts}
                                onChange={(e) => setConfig((current) => ({ ...current, max_posts: Number(e.target.value) || 50 }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                            />
                            <p className="mt-2 text-xs text-slate-500">
                                Final cap after feed collection. Higher RSS depth can exceed this when needed to avoid starving feeds.
                            </p>
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-400">Lookback days</span>
                            <input
                                type="number"
                                min={7}
                                max={30}
                                value={config.lookback_days}
                                onChange={(e) => setConfig((current) => ({ ...current, lookback_days: Number(e.target.value) || 14 }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                            />
                        </label>
                    </div>
                </section>

                <section id="prompts" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <h2 className="text-sm font-semibold text-slate-200">Prompt Overrides</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {config.tracked_symbols.map((symbol) => (
                            <label key={symbol} className="block">
                                <span className="text-xs text-slate-400">{symbol} specialist prompt</span>
                                <textarea
                                    rows={6}
                                    value={config.symbol_prompt_overrides[symbol] ?? ""}
                                    onChange={(e) => updatePromptOverride(symbol, e.target.value)}
                                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                                    placeholder={`Additional guidance for ${symbol}...`}
                                />
                            </label>
                        ))}
                    </div>
                </section>

                {unexecutedTrades.length > 0 && (
                    <section id="executions" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-200">Manage Executions</h2>
                            <p className="text-xs text-slate-500 mt-1">
                                Remove an execution record if it was entered by mistake. The trade recommendation will remain but revert to unexecuted.
                            </p>
                        </div>
                        {deleteError && (
                            <p className="text-xs text-red-400">{deleteError}</p>
                        )}
                        <div className="space-y-2">
                            {unexecutedTrades.map((trade) => (
                                <div
                                    key={trade.id}
                                    className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                                >
                                    <div className="flex items-center gap-4 text-sm">
                                        <span className="font-semibold text-slate-100">{trade.symbol}</span>
                                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${trade.action.toUpperCase() === "BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                                            {trade.action.toUpperCase()}
                                        </span>
                                        <span className="text-slate-400">{trade.leverage}</span>
                                        <span className="text-slate-400">@ ${trade.entry_price.toFixed(2)}</span>
                                        <span className="text-slate-500 text-xs">
                                            {formatTs(trade.recommended_at, timeZone)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => deleteTrade(trade.id)}
                                        disabled={deletingId === trade.id}
                                        className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                                    >
                                        {deletingId === trade.id ? "Removing..." : "Remove"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section id="system" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <h2 className="text-sm font-semibold text-slate-200">Scheduling & System</h2>
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={config.auto_run_enabled}
                            onChange={(e) => setConfig((current) => ({ ...current, auto_run_enabled: e.target.checked }))}
                        />
                        Enable first-load auto-run
                    </label>

                    <label className="block">
                        <span className="text-xs text-slate-400">Auto-run interval minutes</span>
                        <input
                            type="number"
                            min={5}
                            max={360}
                            value={config.auto_run_interval_minutes}
                            onChange={(e) => setConfig((current) => ({ ...current, auto_run_interval_minutes: Number(e.target.value) || 30 }))}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                        />
                    </label>

                    <label className="block">
                        <span className="text-xs text-slate-400">Data ingestion interval seconds (default: 900)</span>
                        <input
                            type="number"
                            min={60}
                            max={3600}
                            value={config.data_ingestion_interval_seconds}
                            onChange={(e) => setConfig((current) => ({ ...current, data_ingestion_interval_seconds: Number(e.target.value) || 900 }))}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                        />
                    </label>

                    <label className="block">
                        <span className="text-xs text-slate-400">Saved snapshot retention limit</span>
                        <input
                            type="number"
                            min={1}
                            max={100}
                            value={config.snapshot_retention_limit}
                            onChange={(e) => setConfig((current) => ({ ...current, snapshot_retention_limit: Number(e.target.value) || 12 }))}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                        />
                        <p className="mt-2 text-xs text-slate-500">
                            Keep only the most recent saved frozen analysis snapshots for Advanced Mode replay.
                        </p>
                    </label>

                    <label className="block">
                        <span className="text-xs text-slate-400">Display timezone</span>
                        <select
                            value={config.display_timezone || storedRaw}
                            onChange={(e) => {
                                setTimeZone(e.target.value);
                                setConfig((current) => ({ ...current, display_timezone: e.target.value }));
                            }}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        >
                            {COMMON_TIMEZONES.map((tz) => (
                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                            ))}
                        </select>
                        <p className="mt-1.5 text-xs text-slate-500">
                            Controls how timestamps appear across the app and is saved with the rest of the runtime config.
                        </p>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Last Started</p>
                            <p className="mt-2">{config.last_analysis_started_at ? formatTs(config.last_analysis_started_at, timeZone) : "Never"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Last Completed</p>
                            <p className="mt-2">{config.last_analysis_completed_at ? formatTs(config.last_analysis_completed_at, timeZone) : "Never"}</p>
                        </div>
                    </div>
                </section>

                {/* Trading Logic */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-200">Trading Logic</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Override the default trading thresholds. Leave blank to use the system defaults from <code className="text-slate-400">logic_config.json</code>.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <label className="block">
                            <span className="text-xs text-slate-400">Paper Trade Amount ($)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Dollar size of each simulated trade. Default: ${config.logic_defaults.paper_trade_amount}</p>
                            <input
                                type="number"
                                min={1} max={100000} step={1}
                                value={config.paper_trade_amount ?? ""}
                                placeholder={String(config.logic_defaults.paper_trade_amount)}
                                onChange={(e) => setConfig((c) => ({ ...c, paper_trade_amount: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Entry Threshold (directional score)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Minimum directional score needed to open a trade (0.05–1.0). Default: {config.logic_defaults.entry_threshold}</p>
                            <input
                                type="number"
                                min={0.05} max={1.0} step={0.01}
                                value={config.entry_threshold ?? ""}
                                placeholder={String(config.logic_defaults.entry_threshold)}
                                onChange={(e) => setConfig((c) => ({ ...c, entry_threshold: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Stop Loss (%)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Max loss before closing a position. Default: {config.logic_defaults.stop_loss_pct}%</p>
                            <input
                                type="number"
                                min={0.1} max={50} step={0.1}
                                value={config.stop_loss_pct ?? ""}
                                placeholder={String(config.logic_defaults.stop_loss_pct)}
                                onChange={(e) => setConfig((c) => ({ ...c, stop_loss_pct: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Take Profit (%)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Target gain before closing a position. Default: {config.logic_defaults.take_profit_pct}%</p>
                            <input
                                type="number"
                                min={0.1} max={100} step={0.1}
                                value={config.take_profit_pct ?? ""}
                                placeholder={String(config.logic_defaults.take_profit_pct)}
                                onChange={(e) => setConfig((c) => ({ ...c, take_profit_pct: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Materiality Gate — Min New Articles</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">How many new articles are needed to justify a thesis flip. Default: {config.logic_defaults.materiality_min_posts_delta}</p>
                            <input
                                type="number"
                                min={1} max={100} step={1}
                                value={config.materiality_min_posts_delta ?? ""}
                                placeholder={String(config.logic_defaults.materiality_min_posts_delta)}
                                onChange={(e) => setConfig((c) => ({ ...c, materiality_min_posts_delta: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Materiality Gate — Min Sentiment Delta</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Minimum change in sentiment score to justify a thesis flip (0.01–1.0). Default: {config.logic_defaults.materiality_min_sentiment_delta}</p>
                            <input
                                type="number"
                                min={0.01} max={1.0} step={0.01}
                                value={config.materiality_min_sentiment_delta ?? ""}
                                placeholder={String(config.logic_defaults.materiality_min_sentiment_delta)}
                                onChange={(e) => setConfig((c) => ({ ...c, materiality_min_sentiment_delta: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>
                    </div>
                </section>

                <div className="flex items-center justify-end gap-3">
                    {status && <span className="text-sm text-slate-400">{status}</span>}
                    <button
                        type="button"
                        onClick={save}
                        disabled={isSaving}
                        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {isSaving ? "Saving..." : "Save Config"}
                    </button>
                </div>

                {/* Price History */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-300">Price History</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Stores daily OHLCV data for all tracked symbols. Used to compute RSI, MACD, Bollinger Bands, ATR, OBV, and moving averages that are fed directly into each analysis. Data is never cleared by a database reset.
                        </p>
                    </div>

                    {priceHistoryStatus && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {Object.entries(priceHistoryStatus.symbols).map(([sym, info]) => (
                                <div key={sym} className={`rounded-lg border px-3 py-2 ${info.ready ? "border-emerald-800/60 bg-emerald-950/20" : "border-amber-800/60 bg-amber-950/20"}`}>
                                    <p className="text-xs font-mono font-bold text-slate-200">{sym}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{info.rows.toLocaleString()} rows</p>
                                    {info.latest_date && (
                                        <p className="text-xs text-slate-500">through {info.latest_date}</p>
                                    )}
                                    {!info.ready && (
                                        <p className="text-xs text-amber-400 mt-0.5">Needs pull</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {!priceHistoryStatus && (
                        <p className="text-xs text-slate-500 italic">Loading status…</p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={handlePullPriceHistory}
                            disabled={isPulling}
                            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPulling ? "Pulling… (slow to avoid rate limits)" : "Pull Price History"}
                        </button>
                        {pullStatus && (
                            <span className={`text-xs ${pullStatus.ok ? "text-emerald-400" : "text-amber-400"}`}>
                                {pullStatus.message}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-600">
                        Pulls ~14 months of daily data per symbol with a 3s delay between each to avoid rate limits.
                        If interrupted, existing data is saved — re-run to fetch remaining symbols.
                    </p>
                </section>

                <section className="rounded-2xl border border-red-900/50 bg-red-950/20 p-5 space-y-4">
                    <div>
                        <h2 className="text-sm font-semibold text-red-400">Danger Zone</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Irreversible actions. Your config settings are not affected.
                        </p>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-red-900/40 bg-slate-950/60 px-4 py-3">
                        <div>
                            <p className="text-sm font-medium text-slate-200">Reset all data</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Deletes all analysis results, trade recommendations, P&amp;L snapshots, and execution records. Config is preserved.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setResetStatus(null); setResetConfirmText(""); setShowResetModal(true); }}
                            className="flex-shrink-0 rounded-lg border border-red-800 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/30"
                        >
                            Reset Database
                        </button>
                    </div>
                </section>
            </div>
        </main>
    );
}
