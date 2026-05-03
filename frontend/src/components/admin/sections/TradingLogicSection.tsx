"use client";

type TradingLogicSectionProps = {
    openCustomRiskModal: () => void;
};

export function TradingLogicSection({ openCustomRiskModal }: TradingLogicSectionProps) {
    return (
        <section id="trading-logic" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">Custom Strategy Controls</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Profile-differentiating controls are managed in the Custom Risk modal to keep default profiles simple.
                </p>
            </div>
            <button
                type="button"
                onClick={openCustomRiskModal}
                className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/20"
            >
                Open Custom Risk Controls
            </button>
        </section>
    );
}
