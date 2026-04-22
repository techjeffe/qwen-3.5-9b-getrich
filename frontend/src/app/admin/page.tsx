"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AppConfig = {
    auto_run_enabled: boolean;
    auto_run_interval_minutes: number;
    tracked_symbols: string[];
    max_posts: number;
    include_backtest: boolean;
    lookback_days: number;
    symbol_prompt_overrides: Record<string, string>;
    data_ingestion_interval_seconds: number;
    last_analysis_started_at: string | null;
    last_analysis_completed_at: string | null;
    last_analysis_request_id: string | null;
    seconds_until_next_auto_run: number;
    can_auto_run_now: boolean;
    supported_symbols: string[];
};

const EMPTY_CONFIG: AppConfig = {
    auto_run_enabled: true,
    auto_run_interval_minutes: 30,
    tracked_symbols: ["USO", "BITO", "QQQ", "SPY"],
    max_posts: 50,
    include_backtest: true,
    lookback_days: 14,
    symbol_prompt_overrides: {},
    data_ingestion_interval_seconds: 900,
    last_analysis_started_at: null,
    last_analysis_completed_at: null,
    last_analysis_request_id: null,
    seconds_until_next_auto_run: 0,
    can_auto_run_now: true,
    supported_symbols: ["BITO", "QQQ", "SPY", "SQQQ", "UNG", "USO"],
};

export default function AdminPage() {
    const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState<string>("");

    useEffect(() => {
        const load = async () => {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            setConfig(await response.json());
        };
        void load();
    }, []);

    const trackedSet = useMemo(() => new Set(config.tracked_symbols), [config.tracked_symbols]);

    const toggleSymbol = (symbol: string) => {
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

    const updatePromptOverride = (symbol: string, value: string) => {
        setConfig((current) => ({
            ...current,
            symbol_prompt_overrides: {
                ...current.symbol_prompt_overrides,
                [symbol]: value,
            },
        }));
    };

    const save = async () => {
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
            setConfig(await response.json());
            setStatus("Saved");
        } catch {
            setStatus("Save failed");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Admin</p>
                        <h1 className="text-3xl font-black mt-2">Runtime Config</h1>
                        <p className="text-sm text-slate-400 mt-2">
                            Control autorun cadence, tracked symbols, and symbol-specialist prompt guidance.
                        </p>
                    </div>
                    <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white">
                        Back
                    </Link>
                </div>

                <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <h2 className="text-sm font-semibold text-slate-200">Scheduling</h2>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Last Started</p>
                            <p className="mt-2">{config.last_analysis_started_at ?? "Never"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Last Completed</p>
                            <p className="mt-2">{config.last_analysis_completed_at ?? "Never"}</p>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                    <h2 className="text-sm font-semibold text-slate-200">Analysis Inputs</h2>

                    <div>
                        <p className="text-xs text-slate-400 mb-3">Tracked symbols</p>
                        <div className="flex flex-wrap gap-2">
                            {config.supported_symbols.map((symbol) => (
                                <button
                                    key={symbol}
                                    type="button"
                                    onClick={() => toggleSymbol(symbol)}
                                    className={`rounded-lg border px-3 py-2 text-sm ${trackedSet.has(symbol)
                                        ? "border-blue-400 bg-blue-500/10 text-blue-200"
                                        : "border-slate-700 bg-slate-800 text-slate-300"
                                        }`}
                                >
                                    {symbol}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="block">
                            <span className="text-xs text-slate-400">Max posts</span>
                            <input
                                type="number"
                                min={1}
                                max={200}
                                value={config.max_posts}
                                onChange={(e) => setConfig((current) => ({ ...current, max_posts: Number(e.target.value) || 50 }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                            />
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
                        <label className="flex items-center gap-3 pt-7 text-sm">
                            <input
                                type="checkbox"
                                checked={config.include_backtest}
                                onChange={(e) => setConfig((current) => ({ ...current, include_backtest: e.target.checked }))}
                            />
                            Include backtest
                        </label>
                    </div>
                </section>

                <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
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
            </div>
        </main>
    );
}
