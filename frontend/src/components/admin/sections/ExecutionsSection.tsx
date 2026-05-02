"use client";

import { formatTs } from "@/lib/timezone";

type UnexecutedTrade = {
    id: number;
    symbol: string;
    action: string;
    leverage: string;
    entry_price: number;
    recommended_at: string;
    request_id: string;
};

type ExecutionsSectionProps = {
    unexecutedTrades: UnexecutedTrade[];
    deletingId: number | null;
    deleteError: string;
    deleteTrade: (id: number) => void;
    timeZone: string;
};

export function ExecutionsSection({ unexecutedTrades, deletingId, deleteError, deleteTrade, timeZone }: ExecutionsSectionProps) {
    return (
        <section id="executions" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">Manage Executions</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Remove an execution record if it was entered by mistake. The trade recommendation will remain but revert to unexecuted.
                </p>
            </div>
            {deleteError && (
                <p className="text-xs text-red-400">{deleteError}</p>
            )}
            {unexecutedTrades.length > 0 ? (
                <div className="space-y-2">
                    {unexecutedTrades.map((trade) => (
                        <div
                            key={trade.id}
                            className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                        >
                            <div className="flex items-center gap-4 text-sm">
                                <span className="font-semibold text-slate-100">{trade.symbol}</span>
                                <span className={`rounded px-2 py-0.5 text-xs font-medium ${trade.action.toUpperCase() === "BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                                    {trade.action.toUpperCase()}
                                </span>
                                <span className="text-slate-400">{trade.leverage}</span>
                                <span className="text-slate-400">@ ${trade.entry_price.toFixed(2)}</span>
                                <span className="text-slate-500 text-xs">
                                    {formatTs(trade.recommended_at, timeZone)}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => deleteTrade(trade.id)}
                                disabled={deletingId === trade.id}
                                className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                            >
                                {deletingId === trade.id ? "Removing..." : "Remove"}
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-5 text-sm text-slate-500">
                    No execution records are available to manage right now.
                </div>
            )}
        </section>
    );
}