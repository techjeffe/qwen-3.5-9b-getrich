"use client";

type LiveConfirmModalProps = {
    showLiveConfirmModal: boolean;
    liveConfirmText: string;
    isEnablingLive: boolean;
    setLiveConfirmText: (text: string) => void;
    setShowLiveConfirmModal: (show: boolean) => void;
    handleSaveAndActivateLive: () => void;
};

export function LiveConfirmModal({
    showLiveConfirmModal,
    liveConfirmText,
    isEnablingLive,
    setLiveConfirmText,
    setShowLiveConfirmModal,
    handleSaveAndActivateLive,
}: LiveConfirmModalProps) {
    if (!showLiveConfirmModal) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-rose-800/60 bg-slate-900 p-6 space-y-4 shadow-2xl">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-rose-600/20 flex items-center justify-center">
                        <span className="text-rose-400 text-xs font-bold">!</span>
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-white">Activate Live Trading</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            You are about to route real-money orders to your Alpaca live account.
                            Confirm by typing the 28 characters below exactly.
                        </p>
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-2">
                        Type <span className="font-mono text-rose-400">ACTIVATE ALPACA LIVE TRADING</span> to confirm
                    </label>
                    <input
                        type="text"
                        value={liveConfirmText}
                        onChange={(e) => setLiveConfirmText(e.target.value)}
                        placeholder="ACTIVATE ALPACA LIVE TRADING"
                        autoFocus
                        maxLength={28}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono text-white outline-none focus:border-rose-500 placeholder:text-slate-600"
                    />
                </div>
                <div className="flex gap-3 justify-end pt-1">
                    <button
                        type="button"
                        onClick={() => { setShowLiveConfirmModal(false); setLiveConfirmText(""); }}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveAndActivateLive}
                        disabled={liveConfirmText !== "ACTIVATE ALPACA LIVE TRADING" || isEnablingLive}
                        className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isEnablingLive ? "Activating..." : "Activate Live Trading"}
                    </button>
                </div>
            </div>
        </div>
    );
}
