"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type OrphanOrder = {
    id: number;
    symbol: string;
    side: string;
    status: string | null;
    trading_mode: string;
    alpaca_order_id: string | null;
    created_at: string | null;
};

type BrokerageSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    isAdvancedMode: boolean;
    orphanOrders?: OrphanOrder[];
    onAcknowledgeOrphan?: (id: number) => void;
    alpacaStatus: {
        secrets: {
            configured: boolean;
            paper: { configured: boolean; api_key_masked: string };
            live:  { configured: boolean; api_key_masked: string };
            error: string;
        };
        execution_mode: "off" | "paper" | "live";
        live_trading_enabled: boolean;
        allow_short_selling: boolean;
        paper_trade_amount_usd: number | null;
        live_trade_amount_usd: number | null;
        max_position_usd: number | null;
        max_total_exposure_usd: number | null;
        order_type: string;
        limit_slippage_pct: number;
        daily_loss_limit_usd: number | null;
        max_consecutive_losses: number | null;
        account: Record<string, unknown> | null;
    } | null;
    alpacaAccountConfigurations: Record<string, unknown> | null;
    alpacaSecretForm: { api_key: string; secret_key: string; trading_mode: "paper" | "live" };
    setAlpacaSecretForm: React.Dispatch<React.SetStateAction<{ api_key: string; secret_key: string; trading_mode: "paper" | "live" }>>;
    alpacaSecretStatus: string;
    alpacaTestResult: { ok: boolean; message: string } | null;
    isSavingAlpacaSecrets: boolean;
    isTestingAlpacaConnection: boolean;
    saveAlpacaSecrets: () => void;
    clearAlpacaSecrets: (mode?: "paper" | "live") => void;
    testAlpacaConnection: (mode?: "paper" | "live") => void;
    openLiveConfirmModal: () => void;
    setAlpacaExecutionMode: (mode: "off" | "paper" | "live") => void;
};

export function BrokerageSection({
    config, setConfig, isAdvancedMode,
    alpacaStatus, alpacaAccountConfigurations,
    alpacaSecretForm, setAlpacaSecretForm,
    alpacaSecretStatus, alpacaTestResult,
    isSavingAlpacaSecrets, isTestingAlpacaConnection,
    saveAlpacaSecrets, clearAlpacaSecrets, testAlpacaConnection,
    openLiveConfirmModal, setAlpacaExecutionMode,
    orphanOrders = [],
    onAcknowledgeOrphan,
}: BrokerageSectionProps) {
    const isLive = config.alpaca_execution_mode === "live";
    const isPaper = config.alpaca_execution_mode === "paper";

    const liveGuardrailsMissing = isLive && (
        config.alpaca_live_trade_amount_usd === null ||
        config.alpaca_max_position_usd === null ||
        config.alpaca_daily_loss_limit_usd === null
    );

    return (
        <section id="alpaca-live-trading" className="scroll-mt-24 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 space-y-5">

            {/* ── Orphan position alerts ── */}
            {orphanOrders.length > 0 && (
                <div className="rounded-xl border border-amber-600/50 bg-amber-950/20 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                        <span className="mt-px text-amber-400 text-sm flex-shrink-0">⚠</span>
                        <div>
                            <p className="text-xs font-semibold text-amber-300">
                                Orphan position{orphanOrders.length > 1 ? "s" : ""} detected
                            </p>
                            <p className="mt-0.5 text-[11px] text-amber-400/80 leading-relaxed">
                                {orphanOrders.length === 1
                                    ? "This position is recorded as open in the local database but was not found in Alpaca live positions. It may have been closed outside the system."
                                    : "These positions are recorded as open in the local database but were not found in Alpaca live positions. They may have been closed outside the system."}
                            </p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {orphanOrders.map((order) => (
                            <div
                                key={order.id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="font-mono text-xs font-semibold text-amber-200">{order.symbol}</span>
                                    <span className="text-[10px] uppercase tracking-wide text-slate-400">{order.trading_mode}</span>
                                    {order.status && (
                                        <span className="text-[10px] text-slate-500">status: {order.status}</span>
                                    )}
                                    {order.created_at && (
                                        <span className="hidden sm:inline text-[10px] text-slate-600">
                                            {new Date(order.created_at).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onAcknowledgeOrphan?.(order.id)}
                                    className="flex-shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] text-slate-300 hover:border-slate-600 hover:bg-slate-700 transition-colors"
                                >
                                    Dismiss
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 1. Execution destination ── */}
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-200">Execution & Brokerage</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Controls order routing to Alpaca. Live mode routes real capital — verify guardrails before enabling.
                        </p>
                    </div>
                    <span className={`self-start rounded-2xl border px-3 py-1.5 text-xs font-semibold ${
                        isLive  ? "border-rose-700/60 bg-rose-950/30 text-rose-300" :
                        isPaper ? "border-sky-700/60 bg-sky-950/30 text-sky-300" :
                                  "border-slate-800 bg-slate-900/80 text-slate-400"
                    }`}>
                        {config.alpaca_execution_mode.toUpperCase()}
                    </span>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(["off", "paper", "live"] as const).map((mode) => {
                        const active = config.alpaca_execution_mode === mode;
                        const label       = mode === "off" ? "Off" : mode === "paper" ? "Alpaca Paper" : "Alpaca Live";
                        const description = mode === "off"
                            ? "No Alpaca routing. System still runs locally."
                            : mode === "paper"
                            ? "Route orders to Alpaca sandbox for isolated testing."
                            : "Route real-money orders to Alpaca live.";
                        const colorCls = mode === "live"
                            ? active
                                ? "border-rose-500 bg-rose-500/15 text-rose-100 shadow-inner"
                                : "border-rose-900/60 bg-slate-900 text-rose-300 hover:border-rose-700 hover:bg-rose-950/30"
                            : mode === "paper"
                            ? active
                                ? "border-sky-400 bg-sky-500/10 text-sky-100 shadow-inner"
                                : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-800"
                            : active
                            ? "border-slate-500 bg-slate-500/10 text-slate-100 shadow-inner"
                            : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-800";
                        return (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => { if (mode === "live") openLiveConfirmModal(); else setAlpacaExecutionMode(mode); }}
                                className={`rounded-3xl border p-4 text-left transition-colors ${colorCls}`}
                            >
                                <p className="text-sm font-semibold">{label}</p>
                                <p className="mt-1 text-[11px] text-slate-400">{description}</p>
                                {mode === "live" && (
                                    <p className="mt-2 text-[10px] text-rose-500/80 font-medium">Routes real capital — confirm to activate</p>
                                )}
                            </button>
                        );
                    })}
                </div>

                {isLive && (
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-800/50 bg-rose-950/20 px-4 py-3">
                        <span className="mt-px text-rose-400 text-sm flex-shrink-0">⚠</span>
                        <p className="text-xs text-rose-300 font-medium leading-relaxed">
                            Live trading is active — real capital is being routed to Alpaca. Confirm the guardrails below are set before running analysis.
                        </p>
                    </div>
                )}

                <p className="mt-3 text-xs text-slate-600">
                    Changing modes takes effect on the next analysis run.
                </p>
            </div>

            {/* ── 2. Live order limits (only when live) ── */}
            {isLive && (
                <div className="rounded-3xl border border-rose-800/60 bg-rose-950/10 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Live order limits</p>
                            <p className="mt-1 text-sm font-semibold text-slate-200">Broker safety limits</p>
                            <p className="mt-1 text-xs text-slate-500">
                                Caps capital per order, per position, and per day. Blank = no protection.
                            </p>
                        </div>
                        <span className="flex-shrink-0 rounded-full border border-rose-700/50 bg-rose-600/15 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-rose-300">
                            Live active
                        </span>
                    </div>

                    {liveGuardrailsMissing && (
                        <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 px-4 py-3">
                            <p className="text-xs text-amber-300 font-medium">
                                ⚠ One or more live guardrails are unset. Trading without position size or daily loss limits can result in unbounded losses.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                        <label className="block">
                            <span className="text-xs text-slate-400">
                                Live order baseline ($)
                                {config.alpaca_live_trade_amount_usd === null && <span className="ml-2 text-amber-400">⚠ Unset</span>}
                            </span>
                            <p className="text-[11px] text-slate-600 mt-0.5">
                                {config.alpaca_fixed_order_size
                                    ? "Fixed — exact amount used for every live order."
                                    : "Scaled ×0.25–×5 per trade by volatility and conviction."}
                            </p>
                            <input
                                type="number"
                                min={1}
                                step={10}
                                value={config.alpaca_live_trade_amount_usd ?? ""}
                                onChange={(e) => setConfig((c) => ({ ...c, alpaca_live_trade_amount_usd: e.target.value === "" ? null : Number(e.target.value) || null }))}
                                placeholder="Required for live trading"
                                className={`mt-1.5 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none bg-slate-900 ${!config.alpaca_live_trade_amount_usd ? "border-amber-700/60 focus:border-amber-400" : "border-slate-700 focus:border-rose-400"}`}
                            />
                            {!config.alpaca_fixed_order_size && config.alpaca_live_trade_amount_usd !== null && config.alpaca_live_trade_amount_usd > 0 && (
                                <p className="mt-1 text-[10px] text-slate-600">
                                    Actual range: <span className="text-slate-400">${Math.round(config.alpaca_live_trade_amount_usd * 0.25).toLocaleString()} – ${Math.round(config.alpaca_live_trade_amount_usd * 5).toLocaleString()}</span>
                                </p>
                            )}
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">
                                Max position size ($)
                                {config.alpaca_max_position_usd === null && <span className="ml-2 text-amber-400">⚠ Unset</span>}
                            </span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Hard cap on any single open position.</p>
                            <input
                                type="number"
                                min={1}
                                step={100}
                                value={config.alpaca_max_position_usd ?? ""}
                                onChange={(e) => setConfig((c) => ({ ...c, alpaca_max_position_usd: e.target.value === "" ? null : Number(e.target.value) || null }))}
                                placeholder="No limit"
                                className={`mt-1.5 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none bg-slate-900 ${!config.alpaca_max_position_usd ? "border-amber-700/60 focus:border-amber-400" : "border-slate-700 focus:border-rose-400"}`}
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Max total exposure ($)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Cap on aggregate open position value.</p>
                            <input
                                type="number"
                                min={1}
                                step={100}
                                value={config.alpaca_max_total_exposure_usd ?? ""}
                                onChange={(e) => setConfig((c) => ({ ...c, alpaca_max_total_exposure_usd: e.target.value === "" ? null : Number(e.target.value) || null }))}
                                placeholder="No cap"
                                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-400"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">
                                Daily loss limit ($)
                                {config.alpaca_daily_loss_limit_usd === null && <span className="ml-2 text-amber-400">⚠ Unset</span>}
                            </span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Halts all trading for the day if realized loss exceeds this.</p>
                            <input
                                type="number"
                                min={1}
                                step={10}
                                value={config.alpaca_daily_loss_limit_usd ?? ""}
                                onChange={(e) => setConfig((c) => ({ ...c, alpaca_daily_loss_limit_usd: e.target.value === "" ? null : Number(e.target.value) || null }))}
                                placeholder="No limit (dangerous)"
                                className={`mt-1.5 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none bg-slate-900 ${!config.alpaca_daily_loss_limit_usd ? "border-amber-700/60 focus:border-amber-400" : "border-slate-700 focus:border-rose-400"}`}
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs text-slate-400">Max consecutive losses</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Pauses trading after N losses in a row. Blank = no circuit breaker.</p>
                            <input
                                type="number"
                                min={1}
                                max={50}
                                step={1}
                                value={config.alpaca_max_consecutive_losses ?? ""}
                                onChange={(e) => setConfig((c) => ({ ...c, alpaca_max_consecutive_losses: e.target.value === "" ? null : Math.max(1, parseInt(e.target.value) || 1) }))}
                                placeholder="No circuit breaker"
                                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-400"
                            />
                        </label>
                    </div>
                </div>
            )}

            {/* ── 3. Order execution ── */}
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 space-y-4">
                <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Order execution</p>
                    <p className="mt-1 text-sm text-slate-300">Order type, slippage tolerance, and position permissions.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block">
                        <span className="text-xs text-slate-400">Order type</span>
                        <select
                            value={config.alpaca_order_type}
                            onChange={(e) => setConfig((c) => ({ ...c, alpaca_order_type: e.target.value }))}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        >
                            <option value="market">Market — fills at best available price</option>
                            <option value="limit">Limit — fills at set price or better</option>
                        </select>
                    </label>

                    {config.alpaca_order_type === "limit" && (
                        <label className="block">
                            <span className="text-xs text-slate-400">Limit slippage tolerance (%)</span>
                            <p className="text-[11px] text-slate-600 mt-0.5">Max spread allowed between signal price and limit price.</p>
                            <input
                                type="number"
                                min={0.01}
                                max={5}
                                step={0.01}
                                value={parseFloat((config.alpaca_limit_slippage_pct * 100).toFixed(3))}
                                onChange={(e) => setConfig((c) => ({ ...c, alpaca_limit_slippage_pct: Number(e.target.value) / 100 || 0.002 }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            />
                        </label>
                    )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs text-slate-400 mb-3">Order sizing mode</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setConfig((c) => ({ ...c, alpaca_fixed_order_size: false }))}
                            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                !config.alpaca_fixed_order_size
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
                            }`}
                        >
                            <p className="text-sm font-semibold">Scale by vol &amp; conviction</p>
                            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                                Each trade is sized to target a consistent daily volatility exposure. Baseline scales ×0.25–×5 based on ATR and signal conviction.
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfig((c) => ({ ...c, alpaca_fixed_order_size: true }))}
                            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                config.alpaca_fixed_order_size
                                    ? "border-slate-400 bg-slate-500/10 text-slate-100"
                                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
                            }`}
                        >
                            <p className="text-sm font-semibold">Fixed amount</p>
                            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                                Every trade uses exactly the configured baseline dollar amount — no ATR or conviction scaling applied to either paper or live orders.
                            </p>
                        </button>
                    </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.alpaca_allow_short_selling}
                            onChange={(e) => setConfig((c) => ({ ...c, alpaca_allow_short_selling: e.target.checked }))}
                            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                        />
                        <span>
                            <span className="block text-sm font-semibold text-slate-200">Allow short selling</span>
                            <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                                Bearish signals open short positions directly rather than routing to inverse ETFs.
                            </span>
                            {config.alpaca_allow_short_selling && alpacaStatus && !alpacaStatus.allow_short_selling && (
                                <span className="block mt-2 text-xs text-amber-400">
                                    ⚠ Alpaca account may not have short selling enabled — verify account permissions before going live.
                                </span>
                            )}
                        </span>
                    </label>
                </div>
            </div>

            {/* ── 4. Paper order sizes ── */}
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 space-y-4">
                <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Paper order sizes</p>
                    <p className="mt-1 text-sm text-slate-300">Simulated position sizes used in paper and strategy mode.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <label className="block">
                        <span className="text-xs text-slate-400">Strategy paper trade amount ($)</span>
                        <input
                            type="number"
                            min={1}
                            step={10}
                            value={config.paper_trade_amount ?? ""}
                            onChange={(e) => setConfig((c) => ({ ...c, paper_trade_amount: e.target.value === "" ? null : Number(e.target.value) || null }))}
                            placeholder={`Default: $${config.logic_defaults.paper_trade_amount}`}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Portfolio cap ($)</span>
                        <input
                            type="number"
                            min={1}
                            step={100}
                            value={config.vol_sizing_portfolio_cap_usd ?? ""}
                            onChange={(e) => setConfig((c) => ({ ...c, vol_sizing_portfolio_cap_usd: e.target.value === "" ? null : Number(e.target.value) || null }))}
                            placeholder="No cap"
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Alpaca paper order size ($)</span>
                        <input
                            type="number"
                            min={1}
                            step={10}
                            value={config.alpaca_paper_trade_amount_usd ?? ""}
                            onChange={(e) => setConfig((c) => ({ ...c, alpaca_paper_trade_amount_usd: e.target.value === "" ? null : Number(e.target.value) || null }))}
                            placeholder="Use strategy amount"
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        />
                    </label>
                </div>
            </div>

            {/* ── 4. Account info ── */}
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

            {/* ── 5. Credentials (full width) ── */}
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Alpaca credentials</p>
                        <p className="mt-1 text-sm text-slate-300">Key status and management per trading mode.</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${
                        isLive  ? "bg-rose-600/15 text-rose-200" :
                        isPaper ? "bg-sky-600/15 text-sky-200" :
                                  "bg-slate-800 text-slate-400"
                    }`}>
                        {config.alpaca_execution_mode === "off" ? "Disabled" : config.alpaca_execution_mode === "paper" ? "Paper" : "Live"}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(["paper", "live"] as const).map((slot) => {
                        const info = alpacaStatus?.secrets?.[slot];
                        const ok = !!info?.configured;
                        return (
                            <div key={slot} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-100 capitalize">{slot} credentials</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {ok
                                            ? `${slot === "live" ? "api.alpaca.markets" : "paper-api.alpaca.markets"} — key ${info.api_key_masked || "…"}`
                                            : slot === "live"
                                            ? "Required to route real orders."
                                            : "Used for Alpaca sandbox testing."}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {ok && (
                                        <>
                                            <button type="button" onClick={() => testAlpacaConnection(slot)} disabled={isTestingAlpacaConnection} className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50">Test</button>
                                            <button type="button" onClick={() => clearAlpacaSecrets(slot)} disabled={isSavingAlpacaSecrets} className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 disabled:opacity-50">Clear</button>
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

                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Add / replace API keys</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="block">
                            <span className="text-xs text-slate-400">API Key ID</span>
                            <input type="password" autoComplete="off" placeholder="PKxxx…" value={alpacaSecretForm.api_key} onChange={(e) => setAlpacaSecretForm((f) => ({ ...f, api_key: e.target.value }))} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white font-mono outline-none focus:border-blue-400" />
                        </label>
                        <label className="block">
                            <span className="text-xs text-slate-400">Secret Key</span>
                            <input type="password" autoComplete="off" placeholder="secret…" value={alpacaSecretForm.secret_key} onChange={(e) => setAlpacaSecretForm((f) => ({ ...f, secret_key: e.target.value }))} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white font-mono outline-none focus:border-blue-400" />
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                            <span className="text-xs text-slate-500">Save to slot:</span>
                            <select value={alpacaSecretForm.trading_mode} onChange={(e) => setAlpacaSecretForm((f) => ({ ...f, trading_mode: e.target.value as "paper" | "live" }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white outline-none focus:border-blue-400">
                                <option value="paper">Paper (sandbox)</option>
                                <option value="live">Live (real money)</option>
                            </select>
                        </label>
                        <button type="button" onClick={saveAlpacaSecrets} disabled={isSavingAlpacaSecrets || !alpacaSecretForm.api_key || !alpacaSecretForm.secret_key} className="rounded-lg bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">
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
            </div>
        </section>
    );
}
