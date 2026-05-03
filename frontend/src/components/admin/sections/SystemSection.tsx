"use client";

import { formatTs, COMMON_TIMEZONES } from "@/lib/timezone";
import { AppConfig } from "@/lib/utils/config-normalizer";

type SystemSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    timeZone: string;
    setTimeZone: (tz: string) => void;
    isAdvancedMode: boolean;
};

export function SystemSection({ config, setConfig, timeZone, setTimeZone, isAdvancedMode }: SystemSectionProps) {
    return (
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
                    type="number" min={5} max={360}
                    value={config.auto_run_interval_minutes}
                    onChange={(e) => setConfig((current) => ({ ...current, auto_run_interval_minutes: Number(e.target.value) || 30 }))}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                />
            </label>

            {isAdvancedMode && (
            <label className="block">
                <span className="text-xs text-slate-400">Data ingestion interval seconds (default: 900)</span>
                <input
                    type="number" min={60} max={3600}
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
                    type="number" min={1} max={100}
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
                    value={config.display_timezone || timeZone}
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
    );
}