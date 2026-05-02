"use client";

import { normalizeSymbolInput } from "@/lib/constants/feed-utils";
import { AppConfig } from "@/lib/utils/config-normalizer";

type SymbolsSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    trackedSet: Set<string>;
    customSymbolSlots: string[];
    toggleTrackedSymbol: (symbol: string) => void;
    updateCustomSymbol: (index: number, value: string) => void;
    updateCustomSymbolAlias: (symbol: string, value: string) => void;
    toggleCustomSymbolTracked: (symbol: string) => void;
};

export function SymbolsSection({
    config, setConfig, trackedSet, customSymbolSlots,
    toggleTrackedSymbol, updateCustomSymbol, updateCustomSymbolAlias, toggleCustomSymbolTracked,
}: SymbolsSectionProps) {
    return (
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
    );
}