"use client";

type DirtyModalProps = {
    showDirtyModal: boolean;
    isSaving: boolean;
    handleDiscardAndLeave: () => void;
    handleSaveAndLeave: () => void;
    setShowDirtyModal: (show: boolean) => void;
};

export function DirtyModal({
    showDirtyModal, isSaving, handleDiscardAndLeave, handleSaveAndLeave, setShowDirtyModal,
}: DirtyModalProps) {
    if (!showDirtyModal) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl">
                <h2 className="text-base font-semibold text-white">Unsaved changes</h2>
                <p className="text-sm text-slate-400">You have unsaved changes. Save before leaving?</p>
                <div className="flex gap-3 justify-end pt-1">
                    <button
                        type="button"
                        onClick={() => setShowDirtyModal(false)}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                        Keep editing
                    </button>
                    <button
                        type="button"
                        onClick={handleDiscardAndLeave}
                        className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:text-white"
                    >
                        Discard
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveAndLeave}
                        disabled={isSaving}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {isSaving ? "Saving..." : "Save & Leave"}
                    </button>
                </div>
            </div>
        </div>
    );
}