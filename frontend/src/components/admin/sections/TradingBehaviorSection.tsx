"use client";

import { useState } from "react";
import { AppConfig } from "@/lib/utils/config-normalizer";

type TradingBehaviorSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
};

export function TradingBehaviorSection({ config, setConfig }: TradingBehaviorSectionProps) {
    const [showDefaults, setShowDefaults] = useState(false);

    return (
        <section id="trading-behavior" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold text-slate-200">Trading Behavior</h2>
                    <p className="text-xs text-slate-500 mt-1">Session behavior controls that apply across profiles.</p>
                </div>
                <button type="button" onClick={() => setShowDefaults(true)} className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800">?</button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={config.allow_extended_hours_trading}
                        onChange={(e) => setConfig((current) => ({ ...current, allow_extended_hours_trading: e.target.checked }))}
                    />
                    Allow pre-market and after-hours paper trading
                </label>
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={config.hold_overnight}
                        onChange={(e) => setConfig((current) => ({ ...current, hold_overnight: e.target.checked }))}
                    />
                    Hold positions overnight when conviction window expires during closed hours
                </label>
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={config.trail_on_window_expiry}
                        onChange={(e) => setConfig((current) => ({ ...current, trail_on_window_expiry: e.target.checked }))}
                    />
                    Activate trailing stop when conviction window expires instead of closing immediately
                </label>
            </div>

            {showDefaults && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl">
                        <h3 className="text-base font-semibold text-white">Default Profile Behavior</h3>
                        <p className="text-sm text-slate-400">Conservative, Standard, and Crazy use shared defaults for strategy gates. Switch to Custom to tune strategy thresholds.</p>
                        <ul className="text-sm text-slate-300 space-y-2">
                            <li>Extended hours: enabled</li>
                            <li>Hold overnight: disabled</li>
                            <li>Trail on expiry: enabled</li>
                        </ul>
                        <div className="flex justify-end">
                            <button type="button" onClick={() => setShowDefaults(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
