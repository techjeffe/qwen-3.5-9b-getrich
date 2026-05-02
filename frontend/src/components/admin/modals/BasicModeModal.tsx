"use client";

type BasicModeModalProps = {
    showBasicModeModal: boolean;
    confirmSwitchToBasic: () => void;
    setShowBasicModeModal: (show: boolean) => void;
};

export function BasicModeModal({
    showBasicModeModal, confirmSwitchToBasic, setShowBasicModeModal,
}: BasicModeModalProps) {
    if (!showBasicModeModal) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-amber-800/60 bg-slate-900 p-6 space-y-4 shadow-2xl">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-amber-600/20 flex items-center justify-center">
                        <span className="text-amber-400 text-xs font-bold">!</span>
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-white">Reset to Basic mode?</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            Switching to Basic will reset all advanced settings to their defaults. This includes trading thresholds,
                            ingestion intervals, parallel slots, and snapshot delivery options.
                        </p>
                        <p className="text-sm text-slate-400 mt-2">
                            Custom RSS feeds and prompt overrides will be hidden but not deleted — switch back to Advanced to access them again.
                        </p>
                    </div>
                </div>
                <div className="flex gap-3 justify-end pt-1">
                    <button
                        type="button"
                        onClick={() => setShowBasicModeModal(false)}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                        Keep Advanced
                    </button>
                    <button
                        type="button"
                        onClick={confirmSwitchToBasic}
                        className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
                    >
                        Reset & Switch to Basic
                    </button>
                </div>
            </div>
        </div>
    );
}