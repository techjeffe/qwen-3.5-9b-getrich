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
    ollama_parallel_slots: number;
    red_team_enabled: boolean;
    risk_profile: string;
    web_research_enabled: boolean;
    allow_extended_hours_trading: boolean;
    hold_overnight: boolean;
    trail_on_window_expiry: boolean;
    reentry_cooldown_minutes: number | null;
    remote_snapshot_enabled: boolean;
    remote_snapshot_mode: "telegram" | "signed_link" | "email";
    remote_snapshot_interval_minutes: number;
    remote_snapshot_send_on_position_change: boolean;
    remote_snapshot_include_closed_trades: boolean;
    remote_snapshot_max_recommendations: number;
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
        reentry_cooldown_minutes: number;
    };
    available_models: string[];
    last_analysis_started_at: string | null;
    last_analysis_completed_at: string | null;
    last_analysis_request_id: string | null;
    last_remote_snapshot_sent_at: string | null;
    last_remote_snapshot_request_id: string | null;
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
    alpaca_execution_mode: "off" | "paper" | "live";
    alpaca_live_trading_enabled: boolean;
    alpaca_allow_short_selling: boolean;
    alpaca_max_position_usd: number | null;
    alpaca_max_total_exposure_usd: number | null;
    alpaca_order_type: string;
    alpaca_limit_slippage_pct: number;
    alpaca_daily_loss_limit_usd: number | null;
    alpaca_max_consecutive_losses: number | null;
};

type AlpacaStatus = {
    secrets: {
        configured: boolean;
        paper: { configured: boolean; api_key_masked: string };
        live:  { configured: boolean; api_key_masked: string };
        error: string;
    };
    execution_mode: "off" | "paper" | "live";
    live_trading_enabled: boolean;
    allow_short_selling: boolean;
    max_position_usd: number | null;
    max_total_exposure_usd: number | null;
    order_type: string;
    limit_slippage_pct: number;
    daily_loss_limit_usd: number | null;
    max_consecutive_losses: number | null;
    account: Record<string, unknown> | null;
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
    ollama_parallel_slots: 1,
    red_team_enabled: true,
    risk_profile: "moderate",
    web_research_enabled: false,
    allow_extended_hours_trading: true,
    hold_overnight: false,
    trail_on_window_expiry: true,
    reentry_cooldown_minutes: null,
    remote_snapshot_enabled: false,
    remote_snapshot_mode: "telegram",
    remote_snapshot_interval_minutes: 360,
    remote_snapshot_send_on_position_change: true,
    remote_snapshot_include_closed_trades: false,
    remote_snapshot_max_recommendations: 4,
    paper_trade_amount: null,
    entry_threshold: null,
    stop_loss_pct: null,
    take_profit_pct: null,
    materiality_min_posts_delta: null,
    materiality_min_sentiment_delta: null,
    logic_defaults: {
        paper_trade_amount: 100,
        entry_threshold: 0.42,
        stop_loss_pct: 2.0,
        take_profit_pct: 3.0,
        materiality_min_posts_delta: 6,
        materiality_min_sentiment_delta: 0.24,
        reentry_cooldown_minutes: 120,
    },
    available_models: [],
    last_analysis_started_at: null,
    last_analysis_completed_at: null,
    last_analysis_request_id: null,
    last_remote_snapshot_sent_at: null,
    last_remote_snapshot_request_id: null,
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
    rss_article_limits: { light: 5, normal: 10, detailed: 20 },
    rss_articles_per_feed: 15,
    alpaca_execution_mode: "off",
    alpaca_live_trading_enabled: false,
    alpaca_allow_short_selling: false,
    alpaca_max_position_usd: null,
    alpaca_max_total_exposure_usd: null,
    alpaca_order_type: "market",
    alpaca_limit_slippage_pct: 0.002,
    alpaca_daily_loss_limit_usd: null,
    alpaca_max_consecutive_losses: 3,
};

const BASIC_MODE_DEFAULTS: Partial<AppConfig> = {
    max_posts: 50,
    lookback_days: 14,
    data_ingestion_interval_seconds: 900,
    snapshot_retention_limit: 12,
    ollama_parallel_slots: 1,
    red_team_enabled: true,
    allow_extended_hours_trading: true,
    hold_overnight: false,
    trail_on_window_expiry: true,
    reentry_cooldown_minutes: null,
    paper_trade_amount: null,
    entry_threshold: null,
    stop_loss_pct: null,
    take_profit_pct: null,
    materiality_min_posts_delta: null,
    materiality_min_sentiment_delta: null,
    remote_snapshot_mode: "telegram",
    remote_snapshot_interval_minutes: 360,
    remote_snapshot_send_on_position_change: true,
    remote_snapshot_include_closed_trades: false,
    remote_snapshot_max_recommendations: 4,
    rss_article_limits: { light: 5, normal: 10, detailed: 20 },
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

type RemoteSnapshotSecretsStatus = {
    available: boolean;
    configured: boolean;
    has_bot_token: boolean;
    has_chat_id: boolean;
    bot_token_masked: string;
    chat_id_masked: string;
    error: string;
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

function normalizeConfigPayload(payload: Partial<AppConfig> | null | undefined): AppConfig {
    const next = {
        ...EMPTY_CONFIG,
        ...(payload ?? {}),
    } as AppConfig;
    const executionMode = next.alpaca_execution_mode === "paper" || next.alpaca_execution_mode === "live"
        ? next.alpaca_execution_mode
        : "off";

    return {
        ...next,
        alpaca_execution_mode: executionMode,
        alpaca_live_trading_enabled: executionMode === "live",
        tracked_symbols: Array.isArray(next.tracked_symbols) ? next.tracked_symbols : EMPTY_CONFIG.tracked_symbols,
        custom_symbols: Array.isArray(next.custom_symbols) ? next.custom_symbols : EMPTY_CONFIG.custom_symbols,
        default_symbols: Array.isArray(next.default_symbols) ? next.default_symbols : EMPTY_CONFIG.default_symbols,
        symbol_prompt_overrides: next.symbol_prompt_overrides ?? {},
        symbol_company_aliases: next.symbol_company_aliases ?? {},
        logic_defaults: {
            ...EMPTY_CONFIG.logic_defaults,
            ...(next.logic_defaults ?? {}),
        },
        available_models: Array.isArray(next.available_models) ? next.available_models : [],
        supported_symbols: Array.isArray(next.supported_symbols) ? next.supported_symbols : EMPTY_CONFIG.supported_symbols,
        default_rss_feeds: Array.isArray(next.default_rss_feeds) ? next.default_rss_feeds : [],
        custom_rss_feeds: Array.isArray(next.custom_rss_feeds) ? next.custom_rss_feeds : [],
        custom_rss_feed_labels: next.custom_rss_feed_labels ?? {},
        enabled_rss_feeds: Array.isArray(next.enabled_rss_feeds) ? next.enabled_rss_feeds : [],
        supported_rss_feeds: Array.isArray(next.supported_rss_feeds) ? next.supported_rss_feeds : [],
        rss_article_limits: {
            ...EMPTY_CONFIG.rss_article_limits,
            ...(next.rss_article_limits ?? {}),
        },
        notices: Array.isArray(next.notices) ? next.notices : [],
    };
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
    const [showRemoteSnapshotSetupModal, setShowRemoteSnapshotSetupModal] = useState(false);
    const [remoteSecrets, setRemoteSecrets] = useState<RemoteSnapshotSecretsStatus>({
        available: false,
        configured: false,
        has_bot_token: false,
        has_chat_id: false,
        bot_token_masked: "",
        chat_id_masked: "",
        error: "",
    });
    const [secretForm, setSecretForm] = useState({ bot_token: "", chat_id: "" });
    const [isSavingSecrets, setIsSavingSecrets] = useState(false);
    const [secretStatus, setSecretStatus] = useState<string>("");
    const [showTelegramInstructions, setShowTelegramInstructions] = useState(false);
    const [isSendingSnapshotNow, setIsSendingSnapshotNow] = useState(false);
    const [sendSnapshotStatus, setSendSnapshotStatus] = useState<string>("");
    const [resetConfirmText, setResetConfirmText] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetStatus, setResetStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [isPulling, setIsPulling] = useState(false);
    const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [isAdvancedMode, setIsAdvancedMode] = useState(false);
    const [showBasicModeModal, setShowBasicModeModal] = useState(false);
    const [priceHistoryStatus, setPriceHistoryStatus] = useState<{
        symbols: Record<string, { rows: number; earliest_date: string | null; latest_date: string | null; ready: boolean }>;
        total_rows: number;
        all_ready: boolean;
    } | null>(null);
    const { timeZone, storedRaw, setTimeZone } = useTimezone();

    const [alpacaStatus, setAlpacaStatus] = useState<AlpacaStatus | null>(null);
    const [alpacaSecretForm, setAlpacaSecretForm] = useState<{ api_key: string; secret_key: string; trading_mode: "paper" | "live" }>({ api_key: "", secret_key: "", trading_mode: "paper" });
    const [alpacaSecretStatus, setAlpacaSecretStatus] = useState<string>("");
    const [isSavingAlpacaSecrets, setIsSavingAlpacaSecrets] = useState(false);
    const [isTestingAlpacaConnection, setIsTestingAlpacaConnection] = useState(false);
    const [alpacaTestResult, setAlpacaTestResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [showLiveConfirmModal, setShowLiveConfirmModal] = useState(false);
    const [liveConfirmText, setLiveConfirmText] = useState("");
    const [isEnablingLive, setIsEnablingLive] = useState(false);
    const [alpacaAccountConfigurations, setAlpacaAccountConfigurations] = useState<Record<string, unknown> | null>(null);

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
    }> = [
        {
            key: "light",
            label: "Light",
            tagline: "Fast single-model run",
            pipeline: "One model handles both entity mapping and reasoning — fastest turnaround.",
        },
        {
            key: "normal",
            label: "Normal",
            tagline: "Balanced, configurable",
            pipeline: "Optionally split entity mapping and reasoning across two models. Falls back to single-model if only one is configured.",
        },
        {
            key: "detailed",
            label: "Detailed",
            tagline: "Full two-model pipeline",
            pipeline: "Always runs Stage 1 entity mapping then Stage 2 reasoning. Requires both models to be set.",
        },
    ];
    const jumpOptions = [
        { value: "overview", label: "Overview", description: "Depth, leverage, and overall runtime posture." },
        { value: "models", label: "Models", description: "Pipeline mode, research, and Ollama model selection." },
        { value: "trading-logic", label: "Trading Logic", description: "Session hours, thresholds, and logic overrides." },
        { value: "symbols", label: "Symbols", description: "Tracked defaults, custom symbols, and aliases." },
        { value: "rss", label: "RSS Sources", description: "Feed universe and article depth controls." },
        { value: "prompts", label: "Prompt Overrides", description: "Per-symbol specialist guidance." },
        { value: "executions", label: "Executions", description: "Manual execution cleanup and review." },
        { value: "system", label: "System", description: "Scheduling, timezone, and run status." },
        { value: "remote-snapshot", label: "Remote Snapshot", description: "Outbound delivery, Telegram setup, and manual sends." },
        { value: "price-history", label: "Price History", description: "Indicator data readiness and pulls." },
        { value: "alpaca-live-trading", label: "Brokerage", description: "Alpaca paper/live routing and broker guardrails." },
        { value: "danger-zone", label: "Danger Zone", description: "Destructive reset actions." },
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

    const hasAdvancedCustomizations = useMemo(() => {
        const d = BASIC_MODE_DEFAULTS;
        return (
            config.max_posts !== d.max_posts ||
            config.lookback_days !== d.lookback_days ||
            config.data_ingestion_interval_seconds !== d.data_ingestion_interval_seconds ||
            config.snapshot_retention_limit !== d.snapshot_retention_limit ||
            config.ollama_parallel_slots !== d.ollama_parallel_slots ||
            config.red_team_enabled !== d.red_team_enabled ||
            config.allow_extended_hours_trading !== d.allow_extended_hours_trading ||
            config.hold_overnight !== d.hold_overnight ||
            config.trail_on_window_expiry !== d.trail_on_window_expiry ||
            config.reentry_cooldown_minutes !== d.reentry_cooldown_minutes ||
            config.paper_trade_amount !== d.paper_trade_amount ||
            config.entry_threshold !== d.entry_threshold ||
            config.stop_loss_pct !== d.stop_loss_pct ||
            config.take_profit_pct !== d.take_profit_pct ||
            config.materiality_min_posts_delta !== d.materiality_min_posts_delta ||
            config.materiality_min_sentiment_delta !== d.materiality_min_sentiment_delta ||
            config.remote_snapshot_mode !== d.remote_snapshot_mode ||
            config.remote_snapshot_interval_minutes !== d.remote_snapshot_interval_minutes ||
            config.remote_snapshot_send_on_position_change !== d.remote_snapshot_send_on_position_change ||
            config.remote_snapshot_include_closed_trades !== d.remote_snapshot_include_closed_trades ||
            config.remote_snapshot_max_recommendations !== d.remote_snapshot_max_recommendations ||
            (config.custom_rss_feeds?.length ?? 0) > 0 ||
            Object.keys(config.symbol_prompt_overrides ?? {}).length > 0
        );
    }, [config]);

    const advancedOnlySections = new Set(["trading-logic", "rss", "prompts", "executions", "price-history"]);
    const visibleJumpOptions = isAdvancedMode
        ? jumpOptions
        : jumpOptions.filter((opt) => !advancedOnlySections.has(opt.value));

    const handleSwitchToBasic = () => {
        if (hasAdvancedCustomizations) {
            setShowBasicModeModal(true);
        } else {
            setIsAdvancedMode(false);
            localStorage.setItem("adminMode", "basic");
        }
    };

    const confirmSwitchToBasic = () => {
        setConfig((current) => ({ ...current, ...BASIC_MODE_DEFAULTS }));
        setIsAdvancedMode(false);
        localStorage.setItem("adminMode", "basic");
        setShowBasicModeModal(false);
    };

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

    const fetchRemoteSnapshotSecrets = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/remote-snapshot-secrets", { cache: "no-store" });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setRemoteSecrets((current) => ({
                    ...current,
                    available: false,
                    configured: false,
                    error: payload?.error || "Failed to load secret status",
                }));
                return;
            }
            setRemoteSecrets({
                available: !!payload.available,
                configured: !!payload.configured,
                has_bot_token: !!payload.has_bot_token,
                has_chat_id: !!payload.has_chat_id,
                bot_token_masked: String(payload.bot_token_masked || ""),
                chat_id_masked: String(payload.chat_id_masked || ""),
                error: String(payload.error || ""),
            });
        } catch {
            setRemoteSecrets((current) => ({
                ...current,
                available: false,
                configured: false,
                error: "Failed to load secret status",
            }));
        }
    }, []);

    const fetchAlpacaStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/alpaca/status", { cache: "no-store" });
            if (res.ok) {
                const statusData = await res.json();
                setAlpacaStatus(statusData);
                if (statusData?.secrets?.configured) {
                    const cfgRes = await fetch("/api/alpaca/account/configurations", { cache: "no-store" });
                    if (cfgRes.ok) setAlpacaAccountConfigurations(await cfgRes.json());
                }
            }
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        if (localStorage.getItem("adminMode") === "advanced") setIsAdvancedMode(true);
    }, []);

    useEffect(() => {
        const load = async () => {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const nextConfig = normalizeConfigPayload(await response.json());
            setConfig(nextConfig);
            setSavedConfig(nextConfig);
            setTimeZone(nextConfig.display_timezone || "");
        };
        void load();
        void fetchUnexecuted();
        void fetchPriceHistoryStatus();
        void fetchRemoteSnapshotSecrets();
        void fetchAlpacaStatus();
    }, [fetchUnexecuted, fetchPriceHistoryStatus, fetchRemoteSnapshotSecrets, fetchAlpacaStatus]);

    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [isDirty]);

    const toggleRemoteSnapshotEnabled = (enabled: boolean) => {
        setConfig((current) => ({ ...current, remote_snapshot_enabled: enabled }));
        if (enabled) {
            setSecretStatus("");
            setShowRemoteSnapshotSetupModal(true);
        }
    };

    const saveRemoteSnapshotSecrets = async () => {
        setIsSavingSecrets(true);
        setSecretStatus("");
        try {
            const response = await fetch("/api/admin/remote-snapshot-secrets", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(secretForm),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setSecretStatus(payload?.error || "Failed to save secrets");
                return;
            }
            setRemoteSecrets({
                available: !!payload.available,
                configured: !!payload.configured,
                has_bot_token: !!payload.has_bot_token,
                has_chat_id: !!payload.has_chat_id,
                bot_token_masked: String(payload.bot_token_masked || ""),
                chat_id_masked: String(payload.chat_id_masked || ""),
                error: String(payload.error || ""),
            });
            setConfig((current) => ({ ...current, remote_snapshot_enabled: true }));
            setSavedConfig((current) => ({ ...current, remote_snapshot_enabled: true }));
            setSecretForm({ bot_token: "", chat_id: "" });
            if (payload?.test_delivery_started) {
                setSecretStatus("Secrets saved. A test snapshot is being sent now.");
            } else if (payload?.test_delivery_note) {
                setSecretStatus(`Secrets saved. ${payload.test_delivery_note}`);
            } else {
                setSecretStatus("Secrets saved to OS keychain");
            }
        } catch {
            setSecretStatus("Failed to save secrets");
        } finally {
            setIsSavingSecrets(false);
        }
    };

    const clearRemoteSnapshotSecrets = async () => {
        setIsSavingSecrets(true);
        setSecretStatus("");
        try {
            const response = await fetch("/api/admin/remote-snapshot-secrets", {
                method: "DELETE",
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setSecretStatus(payload?.error || "Failed to clear secrets");
                return;
            }
            setRemoteSecrets({
                available: !!payload.available,
                configured: !!payload.configured,
                has_bot_token: !!payload.has_bot_token,
                has_chat_id: !!payload.has_chat_id,
                bot_token_masked: String(payload.bot_token_masked || ""),
                chat_id_masked: String(payload.chat_id_masked || ""),
                error: String(payload.error || ""),
            });
            setSecretForm({ bot_token: "", chat_id: "" });
            setSecretStatus("Secrets cleared from OS keychain");
        } catch {
            setSecretStatus("Failed to clear secrets");
        } finally {
            setIsSavingSecrets(false);
        }
    };

    const sendRemoteSnapshotNow = async () => {
        setIsSendingSnapshotNow(true);
        setSendSnapshotStatus("");
        try {
            const response = await fetch("/api/admin/remote-snapshot-send", {
                method: "POST",
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setSendSnapshotStatus(payload?.error || "Failed to queue snapshot send");
                return;
            }
            setSendSnapshotStatus(payload?.message || "Remote snapshot send has been queued.");
        } catch {
            setSendSnapshotStatus("Failed to queue snapshot send");
        } finally {
            setIsSendingSnapshotNow(false);
        }
    };

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
            const committed = normalizeConfigPayload(await response.json());
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
                const nextConfig = normalizeConfigPayload(await cfgRes.json());
                setConfig(nextConfig);
                setSavedConfig(nextConfig);
            }
        } catch {
            setResetStatus({ ok: false, message: "Network error — reset may not have completed" });
        } finally {
            setIsResetting(false);
        }
    };

    const saveAlpacaSecrets = async () => {
        setIsSavingAlpacaSecrets(true);
        setAlpacaSecretStatus("");
        try {
            const response = await fetch("/api/alpaca/secrets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(alpacaSecretForm),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setAlpacaSecretStatus(payload?.error || "Failed to save secrets");
                return;
            }
            setAlpacaSecretForm({ api_key: "", secret_key: "", trading_mode: "paper" });
            setAlpacaSecretStatus("Keys saved to OS keychain");
            await fetchAlpacaStatus();
        } catch {
            setAlpacaSecretStatus("Failed to save secrets");
        } finally {
            setIsSavingAlpacaSecrets(false);
        }
    };

    const clearAlpacaSecrets = async (mode?: "paper" | "live") => {
        setIsSavingAlpacaSecrets(true);
        setAlpacaSecretStatus("");
        try {
            const qs = mode ? `?mode=${mode}` : "";
            const response = await fetch(`/api/alpaca/secrets${qs}`, { method: "DELETE" });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setAlpacaSecretStatus(payload?.error || "Failed to clear secrets");
                return;
            }
            setAlpacaSecretStatus(mode ? `${mode} keys cleared` : "All keys cleared from OS keychain");
            await fetchAlpacaStatus();
        } catch {
            setAlpacaSecretStatus("Failed to clear secrets");
        } finally {
            setIsSavingAlpacaSecrets(false);
        }
    };

    const testAlpacaConnection = async (mode?: "paper" | "live") => {
        setIsTestingAlpacaConnection(true);
        setAlpacaTestResult(null);
        try {
            const qs = mode ? `?mode=${mode}` : "";
            const response = await fetch(`/api/alpaca/test-connection${qs}`, { method: "POST" });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setAlpacaTestResult({ ok: false, message: payload?.error || "Connection failed" });
                return;
            }
            const testedMode = payload?.mode === "live" ? "live" : "paper";
            const equity = payload?.account?.equity ? ` — equity $${Number(payload.account.equity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
            setAlpacaTestResult({ ok: true, message: `Connected (${testedMode}${equity})` });
            await fetchAlpacaStatus();
        } catch {
            setAlpacaTestResult({ ok: false, message: "Network error" });
        } finally {
            setIsTestingAlpacaConnection(false);
        }
    };

    const setAlpacaExecutionMode = async (mode: "off" | "paper" | "live") => {
        setIsEnablingLive(true);
        try {
            const response = await fetch("/api/alpaca/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ alpaca_execution_mode: mode }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                setAlpacaSecretStatus(payload?.error || "Failed to update Alpaca routing");
                return;
            }
            setConfig((current) => ({ ...current, alpaca_execution_mode: mode, alpaca_live_trading_enabled: mode === "live" }));
            setSavedConfig((current) => ({ ...current, alpaca_execution_mode: mode, alpaca_live_trading_enabled: mode === "live" }));
            setShowLiveConfirmModal(false);
            setLiveConfirmText("");
            await fetchAlpacaStatus();
        } catch {
            setAlpacaSecretStatus("Failed to update Alpaca routing");
        } finally {
            setIsEnablingLive(false);
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

    const handleSaveAndExit = async () => {
        await save();
        router.push("/");
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
            {showBasicModeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl border border-amber-800/60 bg-slate-900 p-6 space-y-4 shadow-2xl">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-amber-600/20 flex items-center justify-center">
                                <span className="text-amber-400 text-xs font-bold">!</span>
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-white">Reset to Basic mode?</h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    Switching to Basic will reset all advanced settings to their defaults. This includes trading thresholds,
                                    ingestion intervals, parallel slots, and snapshot delivery options.
                                </p>
                                <p className="text-sm text-slate-400 mt-2">
                                    Custom RSS feeds and prompt overrides will be hidden but not deleted — switch back to Advanced to access them again.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end pt-1">
                            <button
                                type="button"
                                onClick={() => setShowBasicModeModal(false)}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                            >
                                Keep Advanced
                            </button>
                            <button
                                type="button"
                                onClick={confirmSwitchToBasic}
                                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
                            >
                                Reset &amp; Switch to Basic
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showRemoteSnapshotSetupModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm p-4">
                    <div className="flex min-h-full items-start justify-center py-4">
                    <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Remote Snapshot Setup</p>
                                <h2 className="mt-2 text-xl font-semibold text-slate-100">Telegram Bot Setup</h2>
                                <p className="mt-2 text-sm text-slate-400">
                                    Remote snapshots send a PNG to a private Telegram chat. You can store the bot token and chat ID
                                    securely in the OS keychain here, and the backend will read them at send time.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowRemoteSnapshotSetupModal(false)}
                                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                            >
                                Close
                            </button>
                        </div>

                        <div className="mt-5 space-y-4 text-sm text-slate-300">
                            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="font-medium text-slate-100">Secure keychain storage</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            Windows uses Credential Manager. macOS uses Keychain Access.
                                        </p>
                                    </div>
                                    <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                        remoteSecrets.configured ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
                                    }`}>
                                        {remoteSecrets.configured ? "Configured" : "Not configured"}
                                    </span>
                                </div>

                                {remoteSecrets.error && (
                                    <p className="text-xs text-amber-300">{remoteSecrets.error}</p>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                                        <p className="text-slate-500 uppercase tracking-[0.18em]">Saved bot token</p>
                                        <p className="mt-2 truncate font-mono text-slate-200" title={remoteSecrets.bot_token_masked || "Not saved"}>
                                            {remoteSecrets.bot_token_masked || "Not saved"}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                                        <p className="text-slate-500 uppercase tracking-[0.18em]">Saved chat ID</p>
                                        <p className="mt-2 truncate font-mono text-slate-200" title={remoteSecrets.chat_id_masked || "Not saved"}>
                                            {remoteSecrets.chat_id_masked || "Not saved"}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4">
                                    <label className="block">
                                        <span className="text-xs text-slate-400">Telegram bot token</span>
                                        <input
                                            type="password"
                                            value={secretForm.bot_token}
                                            onChange={(e) => setSecretForm((current) => ({ ...current, bot_token: e.target.value }))}
                                            placeholder="123456789:AAExampleBotTokenFromBotFather"
                                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs text-slate-400">Telegram chat ID</span>
                                        <input
                                            type="password"
                                            value={secretForm.chat_id}
                                            onChange={(e) => setSecretForm((current) => ({ ...current, chat_id: e.target.value }))}
                                            placeholder="123456789"
                                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                        />
                                    </label>
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs text-slate-500">
                                        Raw secrets are never returned to the UI after save.
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={clearRemoteSnapshotSecrets}
                                            disabled={isSavingSecrets}
                                            className="rounded-lg border border-red-900/50 px-3 py-2 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-60"
                                        >
                                            Clear Saved Secrets
                                        </button>
                                        <button
                                            type="button"
                                            onClick={saveRemoteSnapshotSecrets}
                                            disabled={isSavingSecrets || !secretForm.bot_token.trim() || !secretForm.chat_id.trim()}
                                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                                        >
                                            {isSavingSecrets ? "Saving..." : "Save To Keychain"}
                                        </button>
                                    </div>
                                </div>

                                {secretStatus && (
                                    <p className={`text-xs ${secretStatus.toLowerCase().includes("failed") ? "text-red-300" : "text-emerald-300"}`}>
                                        {secretStatus}
                                    </p>
                                )}
                            </div>

                            <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-4">
                                <button
                                    type="button"
                                    onClick={() => setShowTelegramInstructions((current) => !current)}
                                    className="w-full text-left"
                                >
                                    <p className="text-sm font-semibold text-sky-300">
                                        {showTelegramInstructions ? "Hide setup instructions" : "Need instructions? Click here"}
                                    </p>
                                    <p className="mt-1 text-xs text-sky-200/80">
                                        BotFather setup, how to find your chat ID, and the env-var fallback.
                                    </p>
                                </button>
                            </div>

                            {showTelegramInstructions && (
                                <>
                                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                        <p className="font-medium text-slate-100">1. Create the bot and copy the bot token</p>
                                        <p className="mt-2 text-slate-400">
                                            In Telegram, open <span className="text-slate-200">@BotFather</span>, send <code>/newbot</code>,
                                            follow the prompts, and copy the token it returns.
                                        </p>
                                        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 font-mono text-xs text-slate-200">
                                            TELEGRAM_BOT_TOKEN=123456789:AAExampleBotTokenFromBotFather
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                        <p className="font-medium text-slate-100">2. Start a private chat with the bot</p>
                                        <p className="mt-2 text-slate-400">
                                            Search for your bot by username in Telegram, open it, and send a simple message like
                                            <code className="mx-1">hello</code>. That creates a chat record for your account.
                                        </p>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                        <p className="font-medium text-slate-100">3. Fetch your chat ID</p>
                                        <p className="mt-2 text-slate-400">
                                            Open this URL in a browser after replacing the token:
                                        </p>
                                        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/70 p-3 font-mono text-xs text-slate-200">
                                            https://api.telegram.org/bot&lt;TELEGRAM_BOT_TOKEN&gt;/getUpdates
                                        </div>
                                        <p className="mt-3 text-slate-400">
                                            In the JSON response, find <code>chat</code> then <code>id</code>. For a personal chat it is usually a positive integer.
                                        </p>
                                        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 font-mono text-xs text-slate-200">
                                            TELEGRAM_CHAT_ID=123456789
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                        <p className="font-medium text-slate-100">4. Save them here or use env vars as a fallback</p>
                                        <p className="mt-2 text-slate-400">
                                            Recommended: use <span className="text-slate-200">Save To Keychain</span> above.
                                            Fallback: set backend env vars manually if you prefer.
                                        </p>
                                        <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-200"><code>{`$env:TELEGRAM_BOT_TOKEN = "123456789:AAExampleBotTokenFromBotFather"
$env:TELEGRAM_CHAT_ID = "123456789"
python run.py`}</code></pre>
                                    </div>
                                </>
                            )}

                            <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-amber-100">
                                <p className="font-medium">Security note</p>
                                <p className="mt-2 text-sm text-amber-200/90">
                                    Keep the bot token private, use a private chat only, and never place these secrets in frontend code or committed files.
                                </p>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
            )}
            {showLiveConfirmModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl border border-rose-800 bg-slate-900 p-6 space-y-4 shadow-2xl">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-rose-600/20 flex items-center justify-center">
                                <span className="text-rose-400 text-xs font-bold">!</span>
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-white">Enable live trading?</h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    This will route real orders to Alpaca using real money. Strategy Paper and Alpaca Paper tracking remain visible; this only changes where broker-side orders are sent.
                                </p>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-2">
                                Type <span className="font-mono text-rose-400">LIVE</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={liveConfirmText}
                                onChange={(e) => setLiveConfirmText(e.target.value)}
                                placeholder="LIVE"
                                autoFocus
                                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono text-white outline-none focus:border-rose-500 placeholder:text-slate-600"
                            />
                        </div>
                        <div className="flex gap-3 justify-end pt-1">
                            <button
                                type="button"
                                onClick={() => { setShowLiveConfirmModal(false); setLiveConfirmText(""); }}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => setAlpacaExecutionMode("live")}
                                disabled={liveConfirmText !== "LIVE" || isEnablingLive}
                                className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isEnablingLive ? "Enabling…" : "Enable Live Trading"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Admin</p>
                        <h1 className="text-3xl font-black mt-2">Runtime Config</h1>
                        <p className="text-sm text-slate-400 mt-2">
                            Control models, data sources, execution behavior, and outbound reporting from one place.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs font-medium">
                            <button
                                type="button"
                                onClick={handleSwitchToBasic}
                                className={`px-3 py-1.5 transition-colors ${!isAdvancedMode ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
                            >
                                Basic
                            </button>
                            <button
                                type="button"
                                onClick={() => { setIsAdvancedMode(true); localStorage.setItem("adminMode", "advanced"); }}
                                className={`px-3 py-1.5 transition-colors ${isAdvancedMode ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
                            >
                                Advanced
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleNavigate("/")}
                            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white"
                        >
                            Back
                        </button>
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
                    <aside className="space-y-4 lg:sticky lg:top-8">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Navigate</p>
                            <nav className="mt-4 space-y-1.5">
                                {visibleJumpOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => jumpToSection(option.value)}
                                        className="w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/80"
                                    >
                                        <p className="text-sm font-medium text-slate-100">{option.label}</p>
                                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{option.description}</p>
                                    </button>
                                ))}
                            </nav>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Current Posture</p>
                            <p className="mt-3 font-semibold text-slate-200">
                                {depthOptions.find((option) => option.key === config.rss_article_detail_mode)?.label ?? "Normal"} depth
                            </p>
                            <p className="mt-3 text-slate-500">Risk profile</p>
                            <p className="mt-1 font-semibold text-slate-200 capitalize">{config.risk_profile || "moderate"}</p>
                            <p className="mt-3 text-slate-500">Tracked symbols</p>
                            <p className="mt-1 font-semibold text-slate-200">{config.tracked_symbols.length}</p>
                        </div>
                    </aside>

                    <div className="space-y-6">
                        <section id="overview" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                        <label className="block lg:hidden">
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
                                {visibleJumpOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 min-w-[160px]">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Active depth</p>
                            <p className="mt-1.5 font-semibold text-slate-200">{depthOptions.find(o => o.key === config.rss_article_detail_mode)?.label ?? "Normal"}</p>
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
                                </button>
                            ))}
                        </div>
                    </div>

                    {isAdvancedMode && (
                    <div>
                        <p className="text-xs text-slate-400 mb-3">Article volume — quick select</p>
                        <p className="text-[11px] text-slate-500 mb-2">
                            Max posts ingested per analysis. Lower = faster Stage 2 (each post adds context tokens). Higher = broader signal coverage.
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[5, 10, 15, 20].map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    onClick={() => setConfig((c) => ({ ...c, max_posts: n }))}
                                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                        config.max_posts === n
                                            ? "border-blue-400 bg-blue-500/10 text-blue-100 font-semibold"
                                            : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700"
                                    }`}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                        <label className="mt-3 block">
                            <span className="text-[11px] text-slate-500">Custom value</span>
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={config.max_posts}
                                onChange={(e) => setConfig((c) => ({ ...c, max_posts: Math.max(1, Math.min(50, parseInt(e.target.value) || 1)) }))}
                                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>
                    </div>
                    )}

                    {isAdvancedMode && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.red_team_enabled}
                                    onChange={(e) => setConfig((c) => ({ ...c, red_team_enabled: e.target.checked }))}
                                    className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                                />
                                <span className="block">
                                    <span className="text-sm font-semibold text-slate-200">Red-team risk review</span>
                                    <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                                        Adversarial pass that re-reads the blue-team signal looking for bias, source skew, and overlooked risks.
                                        Disabling saves one Ollama call per analysis (~30-60s on a slow box) at the cost of the bias countercheck.
                                    </span>
                                </span>
                            </label>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-200">Parallel Ollama slots</span>
                                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                                    Number of Stage 2 specialist calls that may run concurrently. <span className="font-semibold text-slate-200">1</span> = serialized (safe default).
                                </p>
                                <input
                                    type="number"
                                    min={1}
                                    max={8}
                                    value={config.ollama_parallel_slots}
                                    onChange={(e) => setConfig((c) => ({ ...c, ollama_parallel_slots: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) }))}
                                    className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                />
                                {config.ollama_parallel_slots > 1 && (
                                    <p className="mt-2 text-[11px] text-amber-400 leading-relaxed">
                                        ⚠ Requires GPU VRAM headroom AND <code className="font-mono text-amber-300">OLLAMA_NUM_PARALLEL={config.ollama_parallel_slots}</code> set on the Ollama side. Without both, Ollama will OOM or queue silently — undoing the speedup.
                                    </p>
                                )}
                            </label>
                        </div>
                    </div>
                    )}

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

                {isAdvancedMode && (<section id="trading-logic" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-200">Trading Logic</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Override the default trading thresholds. Leave blank to use the system defaults from <code className="text-slate-400">logic_config.json</code>.
                        </p>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-200">Extended-hours trading</p>
                            <p className="mt-1 text-xs text-slate-500">
                                Pre-market runs from 4:00 AM to 9:30 AM ET. After-hours runs from 4:00 PM to 8:00 PM ET.
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                These sessions usually have fewer active participants, which can mean thinner liquidity, wider bid/ask spreads,
                                more price gaps, and faster moves on relatively small order flow.
                            </p>
                        </div>
                        <label className="flex items-center gap-3 text-sm">
                            <input
                                type="checkbox"
                                checked={config.allow_extended_hours_trading}
                                onChange={(e) => setConfig((current) => ({ ...current, allow_extended_hours_trading: e.target.checked }))}
                            />
                            Allow pre-market and after-hours paper trading
                        </label>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-200">Hold overnight</p>
                            <p className="mt-1 text-xs text-slate-500">
                                When enabled, a position whose conviction window expires while the market is closed will
                                not be automatically closed. The position survives until the next open-market run, at
                                which point the normal signal logic applies — it may get re-confirmed, given a new
                                window, or closed based on the latest recommendation.
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                When disabled (default), an expired window closes the position as soon as the next
                                analysis run fires, even overnight. This keeps the simulation conservative — you are
                                never holding a position with no active thesis — but it means a trade that would have
                                re-confirmed at the next open is closed first, then reopened, incurring unnecessary
                                slippage in the simulated P&L.
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                Good choice if: you are trading instruments that can gap significantly overnight (e.g.
                                leveraged ETFs after a macro event) and want the simulation to mirror a trader who
                                sets a hard stop at close. Disable if you want the simulation to carry positions
                                through the night the same way a swing trader would.
                            </p>
                        </div>
                        <label className="flex items-center gap-3 text-sm">
                            <input
                                type="checkbox"
                                checked={config.hold_overnight}
                                onChange={(e) => setConfig((current) => ({ ...current, hold_overnight: e.target.checked }))}
                            />
                            Hold positions overnight when the conviction window expires during closed hours
                        </label>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-200">Trail on window expiry</p>
                            <p className="mt-1 text-xs text-slate-500">
                                When enabled (default), a position whose conviction window expires is not immediately
                                closed. Instead, a trailing stop is activated at half the normal stop-loss distance from
                                the best price seen. The position then stays open until price reverses through the stop.
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                This lets winners run past the original window — if USO is up 2% and the conviction
                                window expires, the trailing stop locks in most of that gain rather than closing flat.
                                The stop tightens each run as price moves further in your favour.
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                When disabled, window expiry closes the position immediately at the current price, the
                                same as a hard time-stop. Use this if you prefer strict time discipline over letting
                                momentum extend the hold.
                            </p>
                        </div>
                        <label className="flex items-center gap-3 text-sm">
                            <input
                                type="checkbox"
                                checked={config.trail_on_window_expiry}
                                onChange={(e) => setConfig((current) => ({ ...current, trail_on_window_expiry: e.target.checked }))}
                            />
                            Activate trailing stop when conviction window expires instead of closing immediately
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <label className="block">
                            <span className="text-xs text-slate-400">Re-entry Cooldown (minutes)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">
                                Block re-opening the same direction on a symbol for this many minutes after a close.
                                Prevents rapid flip-and-re-enter churn. 0 = no cooldown.
                                Default: {config.logic_defaults.reentry_cooldown_minutes} min
                            </p>
                            <input
                                type="number"
                                min={0} max={10080} step={15}
                                value={config.reentry_cooldown_minutes ?? ""}
                                placeholder={String(config.logic_defaults.reentry_cooldown_minutes)}
                                onChange={(e) => setConfig((c) => ({ ...c, reentry_cooldown_minutes: e.target.value === "" ? null : Number(e.target.value) }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>
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
                </section>)}

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

                {isAdvancedMode && (<section id="rss" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-200">RSS Sources</h2>
                        <span className="text-xs text-slate-500 font-mono">
                            {config.rss_article_limits[config.rss_article_detail_mode]} articles/feed · {depthOptions.find(o => o.key === config.rss_article_detail_mode)?.label}
                        </span>
                    </div>

                    <div>
                        <p className="text-xs text-slate-400 mb-3">Articles per feed — by depth</p>
                        <p className="text-[11px] text-slate-500 mb-3">
                            How many articles to fetch from each feed at each depth level. Total ingested = articles/feed × active feeds.
                            The active depth ({depthOptions.find(o => o.key === config.rss_article_detail_mode)?.label}) is highlighted.
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            {(["light", "normal", "detailed"] as const).map((depth) => (
                                <label key={depth} className={`block rounded-xl border p-3 ${config.rss_article_detail_mode === depth ? "border-blue-700/60 bg-blue-950/20" : "border-slate-800 bg-slate-950/40"}`}>
                                    <span className={`block text-xs font-medium capitalize mb-2 ${config.rss_article_detail_mode === depth ? "text-blue-300" : "text-slate-400"}`}>{depth}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={config.rss_article_limits[depth]}
                                        onChange={(e) => updateArticleLimit(depth, e.target.value)}
                                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-blue-400"
                                    />
                                    <span className="block mt-1.5 text-[10px] text-slate-600">per feed, 1–50</span>
                                </label>
                            ))}
                        </div>
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
                </section>)}

                {isAdvancedMode && (<section id="prompts" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
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
                </section>)}

                {isAdvancedMode && (<section id="executions" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-200">Manage Executions</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Remove an execution record if it was entered by mistake. The trade recommendation will remain but revert to unexecuted.
                        </p>
                    </div>
                    {deleteError && (
                        <p className="text-xs text-red-400">{deleteError}</p>
                    )}
                    {unexecutedTrades.length > 0 ? (
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
                    ) : (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-5 text-sm text-slate-500">
                            No execution records are available to manage right now.
                        </div>
                    )}
                </section>)}

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

                    {isAdvancedMode && (
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
                    )}

                    {isAdvancedMode && (
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
                    )}

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

                <section id="remote-snapshot" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-200">Remote Snapshot Delivery</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Generates a PNG summary after qualifying runs and sends it outbound. Secrets stay in the OS keychain or backend env vars.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={sendRemoteSnapshotNow}
                            disabled={isSendingSnapshotNow}
                            className="rounded-lg border border-blue-700 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-950/30 disabled:opacity-50"
                        >
                            {isSendingSnapshotNow ? "Queueing..." : "Send Snapshot Now"}
                        </button>
                    </div>

                    {sendSnapshotStatus && (
                        <p className={`text-xs ${sendSnapshotStatus.toLowerCase().includes("failed") || sendSnapshotStatus.toLowerCase().includes("no completed") ? "text-amber-300" : "text-emerald-300"}`}>
                            {sendSnapshotStatus}
                        </p>
                    )}

                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={config.remote_snapshot_enabled}
                            onChange={(e) => toggleRemoteSnapshotEnabled(e.target.checked)}
                        />
                        Enable remote snapshot delivery
                    </label>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
                        <div>
                            <p className="text-slate-200">Telegram bot setup</p>
                            <p className="mt-1 text-xs text-slate-500">
                                Stored in your OS keychain, not in the repo or frontend bundle.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                remoteSecrets.configured ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
                            }`}>
                                {remoteSecrets.configured ? "Configured" : "Not configured"}
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    setSecretStatus("");
                                    setShowRemoteSnapshotSetupModal(true);
                                }}
                                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                            >
                                Manage Secrets
                            </button>
                        </div>
                    </div>

                    {isAdvancedMode && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-xs text-slate-400">Delivery mode</span>
                            <select
                                value={config.remote_snapshot_mode}
                                onChange={(e) => setConfig((current) => ({ ...current, remote_snapshot_mode: e.target.value as AppConfig["remote_snapshot_mode"] }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            >
                                <option value="telegram">Telegram photo</option>
                                <option value="signed_link">Signed link</option>
                                <option value="email">Email attachment</option>
                            </select>
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Max recommendations on image</span>
                            <input
                                type="number"
                                min={1}
                                max={12}
                                value={config.remote_snapshot_max_recommendations}
                                onChange={(e) => setConfig((current) => ({ ...current, remote_snapshot_max_recommendations: Number(e.target.value) || 4 }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Send every (minutes)</span>
                            <input
                                type="number"
                                min={15}
                                max={10080}
                                value={config.remote_snapshot_interval_minutes}
                                onChange={(e) => setConfig((current) => ({ ...current, remote_snapshot_interval_minutes: Number(e.target.value) || 360 }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                            />
                        </label>
                    </div>
                    )}

                    {isAdvancedMode && (
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={config.remote_snapshot_send_on_position_change}
                            onChange={(e) => setConfig((current) => ({ ...current, remote_snapshot_send_on_position_change: e.target.checked }))}
                        />
                        Send when a position changes (open / close / flip)
                    </label>
                    )}

                    {isAdvancedMode && (
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={config.remote_snapshot_include_closed_trades}
                            onChange={(e) => setConfig((current) => ({ ...current, remote_snapshot_include_closed_trades: e.target.checked }))}
                        />
                        Include recent closed trades on the image
                    </label>
                    )}

                    {isAdvancedMode && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Last Snapshot Sent</p>
                            <p className="mt-2">{config.last_remote_snapshot_sent_at ? formatTs(config.last_remote_snapshot_sent_at, timeZone) : "Never"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Last Snapshot Request</p>
                            <p className="mt-2 font-mono text-xs text-slate-300">{config.last_remote_snapshot_request_id || "None"}</p>
                        </div>
                    </div>
                    )}
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

                <section id="alpaca-live-trading" className="scroll-mt-24 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 space-y-5">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-200">Live Trading — Alpaca</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Connect your Alpaca brokerage account to route real orders alongside paper trades. Secrets are stored in the OS keychain, never in the repo.
                        </p>
                    </div>

                    {/* Credential status — one row per mode */}
                    <div className="space-y-2">
                        {(["paper", "live"] as const).map((slot) => {
                            const info = alpacaStatus?.secrets?.[slot];
                            const ok = !!info?.configured;
                            return (
                                <div key={slot} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
                                    <div>
                                        <p className="text-slate-200 capitalize">{slot} credentials</p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {ok
                                                ? `${slot === "live" ? "api.alpaca.markets" : "paper-api.alpaca.markets"} — key ${info.api_key_masked || "…"}`
                                                : slot === "live" ? "Not set — required to route real orders" : "Not set — used for paper/sandbox testing"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {ok && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => testAlpacaConnection(slot)}
                                                    disabled={isTestingAlpacaConnection}
                                                    className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                                                >
                                                    Test
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => clearAlpacaSecrets(slot)}
                                                    disabled={isSavingAlpacaSecrets}
                                                    className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 disabled:opacity-50"
                                                >
                                                    Clear
                                                </button>
                                            </>
                                        )}
                                        <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                            ok ? (slot === "live" ? "bg-rose-600/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300") : "bg-slate-800 text-slate-400"
                                        }`}>
                                            {ok ? "Configured" : "Not set"}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Key entry form */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                        <p className="text-xs text-slate-400 font-medium">Add / replace API keys</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="block">
                                <span className="text-xs text-slate-500">API Key ID</span>
                                <input
                                    type="password"
                                    autoComplete="off"
                                    placeholder="PKxxx…"
                                    value={alpacaSecretForm.api_key}
                                    onChange={(e) => setAlpacaSecretForm((f) => ({ ...f, api_key: e.target.value }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-mono outline-none focus:border-blue-400"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-500">Secret Key</span>
                                <input
                                    type="password"
                                    autoComplete="off"
                                    placeholder="secret…"
                                    value={alpacaSecretForm.secret_key}
                                    onChange={(e) => setAlpacaSecretForm((f) => ({ ...f, secret_key: e.target.value }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-mono outline-none focus:border-blue-400"
                                />
                            </label>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <label className="flex items-center gap-2 text-sm text-slate-300">
                                <span className="text-xs text-slate-500">Save to slot:</span>
                                <select
                                    value={alpacaSecretForm.trading_mode}
                                    onChange={(e) => setAlpacaSecretForm((f) => ({ ...f, trading_mode: e.target.value as "paper" | "live" }))}
                                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-blue-400"
                                >
                                    <option value="paper">Paper (sandbox)</option>
                                    <option value="live">Live (real money)</option>
                                </select>
                            </label>
                            <button
                                type="button"
                                onClick={saveAlpacaSecrets}
                                disabled={isSavingAlpacaSecrets || !alpacaSecretForm.api_key || !alpacaSecretForm.secret_key}
                                className="rounded-lg bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSavingAlpacaSecrets ? "Saving…" : "Save Keys"}
                            </button>
                        </div>
                        {alpacaSecretStatus && (
                            <p className={`text-xs ${alpacaSecretStatus.toLowerCase().includes("fail") || alpacaSecretStatus.toLowerCase().includes("error") ? "text-amber-300" : "text-emerald-300"}`}>
                                {alpacaSecretStatus}
                            </p>
                        )}
                        {alpacaTestResult && (
                            <p className={`text-xs ${alpacaTestResult.ok ? "text-emerald-300" : "text-amber-300"}`}>
                                {alpacaTestResult.message}
                            </p>
                        )}
                    </div>

                    {/* Account info */}
                    {alpacaStatus?.account && !("error" in alpacaStatus.account) && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {alpacaStatus.account.equity != null && (
                                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Equity</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-200">${Number(alpacaStatus.account.equity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                            )}
                            {alpacaStatus.account.buying_power != null && (
                                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Buying Power</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-200">${Number(alpacaStatus.account.buying_power).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                            )}
                            {alpacaStatus.account.cash != null && (
                                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Cash</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-200">${Number(alpacaStatus.account.cash).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                            )}
                            {alpacaStatus.account.status != null && (
                                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Status</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-200 capitalize">{String(alpacaStatus.account.status)}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Guardrail settings */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-slate-400 font-medium">Order guardrails</p>
                            {config.alpaca_execution_mode === "live" && (
                                <span className="rounded-full bg-rose-600/80 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white">Live</span>
                            )}
                            {config.alpaca_execution_mode === "paper" && (
                                <span className="rounded-full bg-sky-600/30 px-2 py-0.5 text-[10px] uppercase tracking-widest text-sky-200">Paper</span>
                            )}
                        </div>
                        {config.alpaca_execution_mode !== "off" && (
                            <p className={`rounded-lg border px-3 py-2 text-xs ${
                                config.alpaca_execution_mode === "live"
                                    ? "border-rose-800/40 bg-rose-950/40 text-rose-300"
                                    : "border-sky-800/30 bg-sky-950/30 text-sky-300"
                            }`}>
                                {config.alpaca_execution_mode === "live"
                                    ? "Live mode — limits are enforced against your real Alpaca positions and account balance"
                                    : "Paper mode — limits are enforced against the internal paper trade ledger"}
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block">
                                <span className="text-xs text-slate-500">Max position size (USD, blank = unlimited)</span>
                                <input
                                    type="number"
                                    min={0}
                                    placeholder="e.g. 5000"
                                    value={config.alpaca_max_position_usd ?? ""}
                                    onChange={(e) => setConfig((current) => ({ ...current, alpaca_max_position_usd: e.target.value === "" ? null : Number(e.target.value) }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-500">Max total exposure (USD, blank = unlimited)</span>
                                <input
                                    type="number"
                                    min={0}
                                    placeholder="e.g. 20000"
                                    value={config.alpaca_max_total_exposure_usd ?? ""}
                                    onChange={(e) => setConfig((current) => ({ ...current, alpaca_max_total_exposure_usd: e.target.value === "" ? null : Number(e.target.value) }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-500">Daily loss limit (USD, blank = disabled)</span>
                                <input
                                    type="number"
                                    min={0}
                                    placeholder="e.g. 500"
                                    value={config.alpaca_daily_loss_limit_usd ?? ""}
                                    onChange={(e) => setConfig((current) => ({ ...current, alpaca_daily_loss_limit_usd: e.target.value === "" ? null : Number(e.target.value) }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-500">Max consecutive losses before circuit break</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={20}
                                    value={config.alpaca_max_consecutive_losses ?? 3}
                                    onChange={(e) => setConfig((current) => ({ ...current, alpaca_max_consecutive_losses: Number(e.target.value) || 3 }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-500">Order type</span>
                                <select
                                    value={config.alpaca_order_type}
                                    onChange={(e) => setConfig((current) => ({ ...current, alpaca_order_type: e.target.value }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                >
                                    <option value="market">Market</option>
                                    <option value="limit">Limit</option>
                                </select>
                                <p className="mt-1 text-[11px] text-slate-500">
                                    Pre-market and after-hours Alpaca orders are always sent as limit DAY orders with extended-hours enabled.
                                </p>
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-500">Limit slippage (e.g. 0.002 = 0.2%)</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={0.05}
                                    step={0.001}
                                    value={config.alpaca_limit_slippage_pct}
                                    onChange={(e) => setConfig((current) => ({ ...current, alpaca_limit_slippage_pct: Number(e.target.value) || 0.002 }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                />
                            </label>
                        </div>
                        <label className="flex items-center gap-3 text-sm">
                            <input
                                type="checkbox"
                                checked={config.alpaca_allow_short_selling}
                                onChange={(e) => setConfig((current) => ({ ...current, alpaca_allow_short_selling: e.target.checked }))}
                            />
                            Allow direct short selling (for custom symbols without an inverse ETF)
                        </label>
                        {config.alpaca_allow_short_selling && alpacaAccountConfigurations !== null && alpacaAccountConfigurations?.shorting_enabled === false && (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
                                <span className="shrink-0 mt-0.5">⚠</span>
                                <span>
                                    Short selling is <strong>enabled here</strong> but your Alpaca account has <strong>shorting disabled</strong>.
                                    Short orders will be rejected by Alpaca until you enable shorting in your Alpaca account settings.
                                </span>
                            </div>
                        )}
                        <p className="text-xs text-slate-600">Guardrail changes are saved with the Save Config button above.</p>
                    </div>

                    <div className={`rounded-xl border px-4 py-4 ${config.alpaca_execution_mode === "live" ? "border-rose-800/60 bg-rose-950/20" : config.alpaca_execution_mode === "paper" ? "border-sky-800/60 bg-sky-950/10" : "border-slate-800 bg-slate-900/60"}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-sm font-medium text-slate-200">
                                    Broker execution destination
                                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                                        config.alpaca_execution_mode === "live"
                                            ? "bg-rose-600/80 text-white"
                                            : config.alpaca_execution_mode === "paper"
                                            ? "bg-sky-600/30 text-sky-200"
                                            : "bg-slate-700 text-slate-300"
                                    }`}>
                                        {config.alpaca_execution_mode}
                                    </span>
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Strategy Paper always keeps running. This setting only decides whether the same signals are also mirrored to Alpaca paper or Alpaca live.
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <button
                                type="button"
                                onClick={() => void setAlpacaExecutionMode("off")}
                                className={`rounded-xl border px-4 py-3 text-left ${config.alpaca_execution_mode === "off" ? "border-slate-500 bg-slate-800" : "border-slate-800 bg-slate-950/40 hover:bg-slate-900/60"}`}
                            >
                                <p className="text-sm font-medium text-white">Off</p>
                                <p className="mt-1 text-xs text-slate-400">Only the internal strategy paper ledger runs.</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => void setAlpacaExecutionMode("paper")}
                                disabled={!alpacaStatus?.secrets?.paper?.configured}
                                className={`rounded-xl border px-4 py-3 text-left disabled:opacity-40 disabled:cursor-not-allowed ${config.alpaca_execution_mode === "paper" ? "border-sky-500/60 bg-sky-950/20" : "border-slate-800 bg-slate-950/40 hover:bg-slate-900/60"}`}
                            >
                                <p className="text-sm font-medium text-white">Alpaca Paper</p>
                                <p className="mt-1 text-xs text-slate-400">Mirror signals into the broker paper account while keeping Strategy Paper history.</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowLiveConfirmModal(true); setLiveConfirmText(""); }}
                                disabled={!alpacaStatus?.secrets?.live?.configured}
                                className={`rounded-xl border px-4 py-3 text-left disabled:opacity-40 disabled:cursor-not-allowed ${config.alpaca_execution_mode === "live" ? "border-rose-500/60 bg-rose-950/20" : "border-slate-800 bg-slate-950/40 hover:bg-slate-900/60"}`}
                            >
                                <p className="text-sm font-medium text-white">Alpaca Live</p>
                                <p className="mt-1 text-xs text-slate-400">Send real-money orders to Alpaca live while still keeping both paper tracks visible.</p>
                            </button>
                        </div>
                    </div>
                    {!alpacaStatus?.secrets?.paper?.configured && (
                        <p className="text-xs text-amber-400/80">Save paper API keys above before routing signals to Alpaca Paper.</p>
                    )}
                    {!alpacaStatus?.secrets?.live?.configured && config.alpaca_execution_mode !== "live" && (
                        <p className="text-xs text-amber-400/80">Save live API keys above before routing signals to Alpaca Live.</p>
                    )}
                </section>

                {isAdvancedMode && (<section id="price-history" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
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
                </section>)}

                <section id="danger-zone" className="scroll-mt-24 rounded-2xl border border-red-900/50 bg-red-950/20 p-5 space-y-4">
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
                </div>
            </div>

            {/* Floating save / exit panel — stays visible while scrolling */}
            <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
                {status && (
                    <span className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 shadow">{status}</span>
                )}
                <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
                    <button
                        type="button"
                        onClick={() => handleNavigate("/")}
                        className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                    >
                        Back
                    </button>
                    {isDirty && (
                        <button
                            type="button"
                            onClick={handleSaveAndExit}
                            disabled={isSaving}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition-colors"
                        >
                            {isSaving ? "Saving…" : "Save & Exit"}
                        </button>
                    )}
                </div>
            </div>
        </main>
    );
}
