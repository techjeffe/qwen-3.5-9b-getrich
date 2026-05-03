"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type CustomRiskModalProps = {
    show: boolean;
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    onClose: () => void;
};

export function CustomRiskModal({ show, config, setConfig, onClose }: CustomRiskModalProps) {
    if (!show) return null;
    const ld = config.logic_defaults;
    const ramp = config.risk_policy?.crazy_ramp ?? {};
    const fallback = ramp.fallback ?? {};

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Custom Risk Profile</h2>
                        <p className="text-sm text-slate-400 mt-1">These controls are only applied when risk profile is set to Custom.</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Done</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block"><span className="text-xs text-slate-400">Re-entry Cooldown (minutes)</span><input type="number" min={0} max={10080} step={15} value={config.reentry_cooldown_minutes ?? ""} placeholder={String(ld.reentry_cooldown_minutes)} onChange={(e) => setConfig((c) => ({ ...c, reentry_cooldown_minutes: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    <label className="block"><span className="text-xs text-slate-400">Minimum Same-Day Exit Edge (%)</span><input type="number" min={0} max={25} step={0.1} value={config.min_same_day_exit_edge_pct ?? ""} placeholder={String(ld.min_same_day_exit_edge_pct)} onChange={(e) => setConfig((c) => ({ ...c, min_same_day_exit_edge_pct: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    <label className="block"><span className="text-xs text-slate-400">Entry Threshold</span><input type="number" min={0.05} max={1.0} step={0.01} value={config.entry_threshold ?? ""} placeholder={String(ld.entry_threshold)} onChange={(e) => setConfig((c) => ({ ...c, entry_threshold: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    <label className="block"><span className="text-xs text-slate-400">Stop Loss (%)</span><input type="number" min={0.1} max={50} step={0.1} value={config.stop_loss_pct ?? ""} placeholder={String(ld.stop_loss_pct)} onChange={(e) => setConfig((c) => ({ ...c, stop_loss_pct: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    <label className="block"><span className="text-xs text-slate-400">Take Profit (%)</span><input type="number" min={0.1} max={100} step={0.1} value={config.take_profit_pct ?? ""} placeholder={String(ld.take_profit_pct)} onChange={(e) => setConfig((c) => ({ ...c, take_profit_pct: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    <label className="block"><span className="text-xs text-slate-400">Materiality Gate — Min New Articles</span><input type="number" min={1} max={100} step={1} value={config.materiality_min_posts_delta ?? ""} placeholder={String(ld.materiality_min_posts_delta)} onChange={(e) => setConfig((c) => ({ ...c, materiality_min_posts_delta: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    <label className="block"><span className="text-xs text-slate-400">Materiality Gate — Min Sentiment Delta</span><input type="number" min={0.01} max={1.0} step={0.01} value={config.materiality_min_sentiment_delta ?? ""} placeholder={String(ld.materiality_min_sentiment_delta)} onChange={(e) => setConfig((c) => ({ ...c, materiality_min_sentiment_delta: e.target.value === "" ? null : Number(e.target.value) }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                    <p className="text-sm font-semibold text-slate-200">Crazy Ramp Fallback (ATR / volume / retrace)</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="block"><span className="text-xs text-slate-400">Breakout ATR Fraction</span><input type="number" min={0.05} max={2} step={0.01} value={fallback.breakout_atr_fraction ?? 0.45} onChange={(e) => setConfig((c) => ({ ...c, risk_policy: { ...(c.risk_policy ?? {}), crazy_ramp: { ...(c.risk_policy?.crazy_ramp ?? {}), fallback: { ...(c.risk_policy?.crazy_ramp?.fallback ?? {}), breakout_atr_fraction: Number(e.target.value) || 0.45 } } } }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                        <label className="block"><span className="text-xs text-slate-400">Volume Multiplier</span><input type="number" min={1} max={5} step={0.01} value={fallback.volume_multiplier ?? 2.0} onChange={(e) => setConfig((c) => ({ ...c, risk_policy: { ...(c.risk_policy ?? {}), crazy_ramp: { ...(c.risk_policy?.crazy_ramp ?? {}), fallback: { ...(c.risk_policy?.crazy_ramp?.fallback ?? {}), volume_multiplier: Number(e.target.value) || 2.0 } } } }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                        <label className="block"><span className="text-xs text-slate-400">Retrace Guard</span><input type="number" min={0.05} max={1} step={0.01} value={fallback.retrace_guard ?? 0.2} onChange={(e) => setConfig((c) => ({ ...c, risk_policy: { ...(c.risk_policy ?? {}), crazy_ramp: { ...(c.risk_policy?.crazy_ramp ?? {}), fallback: { ...(c.risk_policy?.crazy_ramp?.fallback ?? {}), retrace_guard: Number(e.target.value) || 0.2 } } } }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="block"><span className="text-xs text-slate-400">Fetch Timeout (ms)</span><input type="number" min={500} max={10000} step={100} value={ramp.fetch_timeout_ms ?? 2500} onChange={(e) => setConfig((c) => ({ ...c, risk_policy: { ...(c.risk_policy ?? {}), crazy_ramp: { ...(c.risk_policy?.crazy_ramp ?? {}), fetch_timeout_ms: Number(e.target.value) || 2500 } } }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                        <label className="block"><span className="text-xs text-slate-400">Evaluation Timeout (ms)</span><input type="number" min={1000} max={60000} step={500} value={ramp.eval_timeout_ms ?? 15000} onChange={(e) => setConfig((c) => ({ ...c, risk_policy: { ...(c.risk_policy ?? {}), crazy_ramp: { ...(c.risk_policy?.crazy_ramp ?? {}), eval_timeout_ms: Number(e.target.value) || 15000 } } }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                        <label className="block"><span className="text-xs text-slate-400">Stale Data Cutoff (ms)</span><input type="number" min={1000} max={300000} step={1000} value={ramp.stale_ms ?? 120000} onChange={(e) => setConfig((c) => ({ ...c, risk_policy: { ...(c.risk_policy ?? {}), crazy_ramp: { ...(c.risk_policy?.crazy_ramp ?? {}), stale_ms: Number(e.target.value) || 120000 } } }))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" /></label>
                    </div>
                </div>
            </div>
        </div>
    );
}
