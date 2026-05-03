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
    toggleTelegramRemoteControlEnabled: (enabled: boolean) => void;
    remoteSecrets: {
        available: boolean;
        configured: boolean;
        has_bot_token: boolean;
        has_chat_id: boolean;
        has_authorized_user_id: boolean;
        bot_token_masked: string;
        chat_id_masked: string;
        authorized_user_id_masked: string;
        error: string;
    };
    setShowRemoteSnapshotSetupModal: (show: boolean) => void;
};

export function RemoteSnapshotSection({
    config, setConfig, isAdvancedMode, timeZone,
    sendSnapshotStatus, isSendingSnapshotNow, sendSnapshotNow,
    toggleRemoteSnapshotEnabled, toggleTelegramRemoteControlEnabled, remoteSecrets, setShowRemoteSnapshotSetupModal,
}: RemoteSnapshotSectionProps) {
    return (
        <section id="remote-snapshot" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-sm font-semibold text-slate-200">Telegram</h2>
                    <p className="mt-1 text-xs text-slate-500">
                        Telegram credentials are shared, but snapshot delivery and remote trading control are enabled separately.
                    </p>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
                <div>
                    <p className="text-slate-200">Telegram credentials</p>
                    <p className="mt-1 text-xs text-slate-500">
                        Stored in your OS keychain, not in the repo or frontend bundle. One setup powers both Telegram features below.
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

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-200">Remote Snapshots</h3>
                            <p className="mt-1 text-xs text-slate-500">
                                Generates a PNG summary after qualifying runs and sends it through the configured Telegram delivery path.
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

                    {isAdvancedMode && (
                    <div className="grid grid-cols-1 gap-4">
                        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-400">
                            Delivery channel is currently fixed to <span className="font-mono text-slate-200">Telegram photo</span>.
                        </div>
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
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-4">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-200">Remote Control</h3>
                        <p className="mt-1 text-xs text-slate-500">
                            Allows Telegram bot commands like <span className="font-mono text-slate-300">/status</span>, <span className="font-mono text-slate-300">/stop</span>, and <span className="font-mono text-slate-300">/start</span> to control trading mode.
                        </p>
                    </div>

                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={config.telegram_remote_control_enabled}
                            onChange={(e) => toggleTelegramRemoteControlEnabled(e.target.checked)}
                        />
                        Enable Telegram remote control
                    </label>

                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-400">
                        Uses the same hardened Telegram credentials as snapshots, but remains independently enabled so you can send alerts without granting bot control.
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Supported Commands</p>
                        <div className="space-y-2 text-xs text-slate-400">
                            <p><span className="font-mono text-slate-200">/status</span> shows the current Alpaca execution mode. It reports whether trading is <span className="font-mono text-slate-200">OFF</span>, <span className="font-mono text-slate-200">PAPER</span>, or <span className="font-mono text-slate-200">LIVE</span>. It does not place, close, or modify trades.</p>
                            <p><span className="font-mono text-slate-200">/stop</span> switches Alpaca execution mode to <span className="font-mono text-slate-200">OFF</span> and saves the previous mode so it can be resumed later. It does not cancel manual positions, liquidate holdings, or change broader app settings.</p>
                            <p><span className="font-mono text-slate-200">/start</span> restores the previously saved execution mode after a <span className="font-mono text-slate-200">/stop</span>. It does not invent a new mode, bypass admin configuration, or enable trading if no prior mode was saved.</p>
                            <p><span className="font-mono text-slate-200">/help</span> returns the in-bot command list. It does not change any runtime state.</p>
                        </div>
                    </div>
                </div>
            </div>

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
