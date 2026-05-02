"use client";

type DangerZoneModalProps = {
    showResetModal: boolean;
    resetConfirmText: string;
    resetStatus: { ok: boolean; message: string } | null;
    isResetting: boolean;
    setResetConfirmText: (text: string) => void;
    setShowResetModal: (show: boolean) => void;
    setResetStatus: (status: { ok: boolean; message: string } | null) => void;
    handleResetDatabase: () => void;
};

export function DangerZoneModal({
    showResetModal, resetConfirmText, resetStatus, isResetting,
    setResetConfirmText, setShowResetModal, setResetStatus, handleResetDatabase,
}: DangerZoneModalProps) {
    if (!showResetModal) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-red-800 bg-slate-900 p-6 space-y-4 shadow-2xl">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-red-600/20 flex items-center justify-center">
                        <span className="text-red-400 text-xs font-bold">!</span>
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-white">Reset all data?</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            This permanently deletes all analysis results, trade recommendations, P&L snapshots, and execution records.
                            Your config settings are preserved. This cannot be undone.
                        </p>
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-2">
                        Type <span className="font-mono text-red-400">RESET</span> to confirm
                    </label>
                    <input
                        type="text"
                        value={resetConfirmText}
                        onChange={(e) => setResetConfirmText(e.target.value)}
                        placeholder="RESET"
                        autoFocus
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono text-white outline-none focus:border-red-500 placeholder:text-slate-600"
                    />
                </div>
                {resetStatus && (
                    <p className={`text-xs ${resetStatus.ok ? "text-emerald-400" : "text-red-400"}`}>
                        {resetStatus.message}
                    </p>
                )}
                <div className="flex gap-3 justify-end pt-1">
                    <button
                        type="button"
                        onClick={() => { setShowResetModal(false); setResetConfirmText(""); setResetStatus(null); }}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleResetDatabase}
                        disabled={resetConfirmText !== "RESET" || isResetting}
                        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isResetting ? "Resetting..." : "Reset Database"}
                    </button>
                </div>
            </div>
        </div>
    );
}