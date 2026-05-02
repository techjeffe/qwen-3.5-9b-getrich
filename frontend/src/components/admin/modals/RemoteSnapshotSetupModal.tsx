"use client";

type RemoteSnapshotSetupModalProps = {
    showRemoteSnapshotSetupModal: boolean;
    telegramBotToken: string;
    telegramChatId: string;
    setTelegramBotToken: (val: string) => void;
    setTelegramChatId: (val: string) => void;
    saveRemoteSecrets: () => void;
    clearRemoteSecrets: () => void;
    isSavingSecrets: boolean;
    secretStatus: string;
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

export function RemoteSnapshotSetupModal({
    showRemoteSnapshotSetupModal,
    telegramBotToken,
    telegramChatId,
    setTelegramBotToken,
    setTelegramChatId,
    saveRemoteSecrets,
    clearRemoteSecrets,
    isSavingSecrets,
    secretStatus,
    remoteSecrets,
    setShowRemoteSnapshotSetupModal,
}: RemoteSnapshotSetupModalProps) {
    if (!showRemoteSnapshotSetupModal) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Remote Snapshot Secrets</h2>
                    <button
                        type="button"
                        onClick={() => setShowRemoteSnapshotSetupModal(false)}
                        className="text-slate-500 hover:text-white text-lg"
                    >
                        &times;
                    </button>
                </div>
                {!remoteSecrets.available && (
                    <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
                        Remote secrets storage is not available. Secrets will be stored in backend config instead.
                    </p>
                )}
                {remoteSecrets.error && (
                    <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                        {remoteSecrets.error}
                    </p>
                )}
                {remoteSecrets.configured && (
                    <div className="flex items-center gap-2 text-emerald-400 text-xs">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Secrets are configured for this user
                    </div>
                )}

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <div>
                        <span className="text-xs text-slate-400 font-medium">Telegram Bot Token</span>
                    </div>
                    {remoteSecrets.has_bot_token && (
                        <p className="text-[11px] text-slate-500">Saved: <span className="font-mono text-slate-300">{remoteSecrets.bot_token_masked}</span></p>
                    )}
                    <input
                        type="password"
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        placeholder="Bot token (123:ABC...)"
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono outline-none focus:border-blue-400"
                    />
                    <p className="text-[11px] text-slate-600">
                        Obtain from <span className="font-mono">@BotFather</span> on Telegram
                    </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <div>
                        <span className="text-xs text-slate-400 font-medium">Chat ID</span>
                    </div>
                    {remoteSecrets.has_chat_id && (
                        <p className="text-[11px] text-slate-500">Saved: <span className="font-mono text-slate-300">{remoteSecrets.chat_id_masked}</span></p>
                    )}
                    <input
                        type="password"
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value)}
                        placeholder="-1001234567890"
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono outline-none focus:border-blue-400"
                    />
                    <p className="text-[11px] text-slate-600">
                        Find yours via <span className="font-mono">@userinfobot</span> or your bot's /mychanges command
                    </p>
                </div>

                {secretStatus && (
                    <p className={`text-xs ${secretStatus.toLowerCase().includes("fail") || secretStatus.toLowerCase().includes("error") ? "text-amber-300" : "text-emerald-300"}`}>
                        {secretStatus}
                    </p>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        type="button"
                        onClick={clearRemoteSecrets}
                        disabled={isSavingSecrets}
                        className="rounded-lg border border-red-800/60 px-4 py-2 text-sm text-red-300 hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Clear Saved Secrets
                    </button>
                    <button
                        type="button"
                        onClick={saveRemoteSecrets}
                        disabled={isSavingSecrets || !telegramBotToken.trim() || !telegramChatId.trim()}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSavingSecrets ? "Saving..." : "Save To Keychain"}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowRemoteSnapshotSetupModal(false)}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                        Close
                    </button>
                </div>
                <p className="text-[11px] text-slate-500">
                    Save requires both bot token and chat ID together.
                </p>
            </div>
        </div>
    );
}
