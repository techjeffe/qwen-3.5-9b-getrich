"use client";

import { formatTs } from "@/lib/timezone";
import { AppConfig } from "@/lib/utils/config-normalizer";

type RemoteSnapshotSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    isAdvancedMode: boolean;
    timeZone: string;
    sendSnapshotStatus: string;
    isSendingSnapshotNow: boolean;
    sendSnapshotNow: () => void;
    toggleRemoteSnapshotEnabled: (enabled: boolean) => void;
    remoteSecrets: {
        available: boolean;
        configured: boolean;
        has_bot_token: boolean;
        has_chat_id: boolean;
        bot_token_masked: string;
        chat_id_masked: string;
        error: string;
    };
    setShowRemoteSnapshotSetupModal: (show: boolean) => void;
};

export function RemoteSnapshotSection({
    config, setConfig, isAdvancedMode, timeZone,
    sendSnapshotStatus, isSendingSnapshotNow, sendSnapshotNow,
    toggleRemoteSnapshotEnabled, remoteSecrets, setShowRemoteSnapshotSetupModal,
}: RemoteSnapshotSectionProps) {
    return (
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
                    onClick={sendSnapshotNow}
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
                        onClick={() => setShowRemoteSnapshotSetupModal(true)}
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
    );
}