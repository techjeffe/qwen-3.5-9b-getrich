"use client";

import { Recommendation, PnLTrade } from "@/lib/types/analysis";
import { Prices } from "@/lib/types/analysis";
import { X, ArrowRight, AlertTriangle } from "lucide-react";
import { UNDERLYING_PRICE_MAP, EXECUTION_SYMBOLS_BY_UNDERLYING } from "@/lib/constants/analysis";

interface TradeExecutionModalProps {
    recommendation: Recommendation;
    trade: PnLTrade | null;
    onClose: () => void;
    onSave: (payload: { executedAction: "BUY" | "SELL"; executedPrice: number }) => Promise<void>;
}

export default function TradeExecutionModal({
    recommendation,
    trade,
    onClose,
    onSave,
}: TradeExecutionModalProps) {
    const underlying = recommendation.underlying_symbol || recommendation.symbol;
    const isBuy = recommendation.action === "BUY";

    // Find available execution symbols for this underlying
    const executionSymbols = EXECUTION_SYMBOLS_BY_UNDERLYING[underlying] || [underlying];

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const priceStr = formData.get("price") as string;
        const price = parseFloat(priceStr);
        if (isNaN(price) || price <= 0) return;
        await onSave({ executedAction: recommendation.action, executedPrice: price });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-lg rounded-2xl border border-slate-700/50 shadow-2xl"
                style={{ background: "rgba(15,23,42,0.95)", backdropFilter: "blur(16px)" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                    <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${
                            isBuy
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-red-500/20 text-red-400"
                        }`}>
                            {recommendation.action}
                        </span>
                        <span className="text-lg font-bold text-white">{underlying}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
                    {/* Recommendation details */}
                    <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Recommendation</p>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span className="text-slate-500">Leverage: </span>
                                <span className="font-mono font-bold text-slate-300">{recommendation.leverage}</span>
                            </div>
                            <div>
                                <span className="text-slate-500">Thesis: </span>
                                <span className={`font-mono font-bold ${
                                    recommendation.thesis === "LONG" ? "text-emerald-400" :
                                    recommendation.thesis === "SHORT" ? "text-red-400" :
                                    "text-slate-400"
                                }`}>{recommendation.thesis || "N/A"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Available execution symbols */}
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Available Execution Symbols</p>
                        <div className="flex flex-wrap gap-1.5">
                            {executionSymbols.map((sym) => (
                                <span
                                    key={sym}
                                    className={`text-xs px-2 py-1 rounded border ${
                                        sym === underlying
                                            ? "border-blue-500/40 bg-blue-500/10 text-blue-300 font-bold"
                                            : "border-slate-700/40 bg-slate-800/30 text-slate-400"
                                    }`}
                                >
                                    {sym}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Price input */}
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">
                            Execution Price (USD)
                        </label>
                        <input
                            name="price"
                            type="number"
                            step="0.01"
                            min="0.01"
                            defaultValue={trade?.entry_price?.toString() ?? ""}
                            placeholder="Enter execution price..."
                            required
                            className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-2.5 text-sm font-mono text-white placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                        />
                    </div>

                    {/* Trade details if available */}
                    {trade && (
                        <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Trade Details</p>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <span className="text-slate-500">Entry Price: </span>
                                    <span className="font-mono text-slate-300">${trade.entry_price.toFixed(2)}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500">Notional: </span>
                                    <span className="font-mono text-slate-300">
                                        {trade.paper_notional_usd ? `$${trade.paper_notional_usd.toFixed(2)}` : "N/A"}
                                    </span>
                                </div>
                                {trade.paper_shares && (
                                    <div>
                                        <span className="text-slate-500">Shares: </span>
                                        <span className="font-mono text-slate-300">{trade.paper_shares}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Warning */}
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                        <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-amber-300/80">
                            This will record an actual trade execution. Make sure the price is accurate before saving.
                        </p>
                    </div>
                </form>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/50">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="trade-execution-form"
                        className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                        onClick={(e) => {
                            // Trigger the form submit
                            const form = e.currentTarget.closest("form");
                            if (form) form.requestSubmit();
                        }}
                    >
                        <ArrowRight size={14} />
                        Execute Trade
                    </button>
                </div>
            </div>
        </div>
    );
}