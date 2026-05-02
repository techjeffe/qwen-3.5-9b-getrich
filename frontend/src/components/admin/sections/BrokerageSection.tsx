"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type BrokerageSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    isAdvancedMode: boolean;
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
}: BrokerageSectionProps) {
    return (
        <section id="alpaca-live-trading" className="scroll-mt-24 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 space-y-5">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">Live Trading — Alpaca</h2>
                <p className="mt-1 text-xs text-slate-500">
                    Connect your Alpaca brokerage account to route real orders alongside paper trades. Secrets are stored in the OS keychain, never in the repo.
                </p>
            </div>

            {/* Credential status */}
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

            {/* Execution destination */}
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
                        onClick={openLiveConfirmModal}
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
    );
}
