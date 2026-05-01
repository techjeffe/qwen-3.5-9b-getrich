"use client";

import GlassCard from "./GlassCard";
import { PnLSummary, TradeCloseRecord } from "@/lib/types/analysis";
import { Prices } from "@/lib/types/analysis";
import { formatSignedUsd, paperPnlUsd } from "@/lib/utils/timing";

interface ActualTradeComparisonCardProps {
    pnlSummary: PnLSummary | null;
    currentRequestId: string | undefined;
    prices: Prices | null;
    onCloseTrade: (tradeId: number, closedPrice: number, notes: string) => void;
}

export default function ActualTradeComparisonCard({
    pnlSummary,
    currentRequestId,
    prices,
    onCloseTrade,
}: ActualTradeComparisonCardProps) {
    if (!pnlSummary || !currentRequestId) {
        return null;
    }

    const currentTrades = pnlSummary.trades.filter((t) => t.request_id === currentRequestId);
    const closedTrades = currentTrades.filter((t) => t.trade_close);
    const openTrades = currentTrades.filter((t) => !t.trade_close);

    if (currentTrades.length === 0) {
        return null;
    }

    const handleToggle = (tradeId: number) => {
        const el = document.getElementById(`close-form-${tradeId}`);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    };

    const handleSaveClose = async (
        tradeId: number,
        symbol: string,
        entryPrice: number,
        action: "BUY" | "SELL"
    ) => {
        const price = prompt(`Enter close price for ${symbol}:`, prices?.[symbol]?.price?.toString() ?? "");
        if (price === null) return;
        const closedPrice = parseFloat(price);
        if (isNaN(closedPrice)) return;

        const notesPrompt = prompt("Add notes (optional):", "");
        const notes = notesPrompt ?? "";

        await onCloseTrade(tradeId, closedPrice, notes);
    };

    return (
        <GlassCard>
            <h2 className="text-sm font-semibold text-slate-300 mb-4">
                Trade Performance — {currentRequestId.slice(0, 8)}
            </h2>

            {/* Execution Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Executed</p>
                    <p className="text-lg font-bold text-blue-400">
                        {pnlSummary.execution_summary.executed_trades}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Matched</p>
                    <p className="text-lg font-bold text-emerald-400">
                        {pnlSummary.execution_summary.matched_recommendation}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Match Rate</p>
                    <p className="text-lg font-bold text-yellow-400">
                        {(pnlSummary.execution_summary.match_rate * 100).toFixed(1)}%
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Rec. Return</p>
                    <p className={`text-lg font-bold ${pnlSummary.execution_summary.avg_latest_recommended_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pnlSummary.execution_summary.avg_latest_recommended_return_pct.toFixed(2)}%
                    </p>
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Avg Actual Return</p>
                    <p className={`text-lg font-bold ${pnlSummary.execution_summary.avg_latest_actual_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pnlSummary.execution_summary.avg_latest_actual_return_pct.toFixed(2)}%
                    </p>
                </div>
            </div>

            {/* Paper Trade Notional */}
            {pnlSummary.paper_trade_notional_usd && (
                <div className="mb-6 rounded-xl border border-slate-700/50 bg-slate-900/50 px-4 py-3 text-sm">
                    <p className="text-slate-500">Paper Trade Notional</p>
                    <p className="text-lg font-mono font-bold text-blue-300">
                        {formatSignedUsd(pnlSummary.paper_trade_notional_usd)}
                    </p>
                </div>
            )}

            {/* Open Trades */}
            {openTrades.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                        Open Positions ({openTrades.length})
                    </h3>
                    <div className="space-y-3">
                        {openTrades.map((trade) => {
                            const snapshotEntry = trade.comparison;
                            const snapshotPrice = snapshotEntry?.snapshot_price;
                            const currentPrice = prices?.[trade.symbol]?.price;
                            const displayPrice = snapshotPrice ?? currentPrice;

                            return (
                                <div
                                    key={trade.id}
                                    className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${trade.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                {trade.action}
                                            </span>
                                            <span className="text-sm font-bold text-white">{trade.symbol}</span>
                                            <span className="text-xs text-slate-500 font-mono">#{trade.id}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {snapshotEntry && (
                                                <div className="text-right">
                                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Rec. Return</p>
                                                    <p className={`text-sm font-bold font-mono ${snapshotEntry.recommended_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {snapshotEntry.recommended_return_pct >= 0 ? "+" : ""}
                                                        {snapshotEntry.recommended_return_pct.toFixed(2)}%
                                                    </p>
                                                </div>
                                            )}
                                            {trade.actual_execution && (
                                                <div className="text-right">
                                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Actual Return</p>
                                                    <p className="text-sm font-bold font-mono text-blue-400">
                                                        —
                                                    </p>
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleSaveClose(trade.id, trade.symbol, trade.entry_price, trade.action)}
                                                className="text-xs bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors"
                                            >
                                                Close
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Entry</p>
                                            <p className="font-mono text-slate-300">{trade.entry_price.toFixed(2)}</p>
                                        </div>
                                        {displayPrice && (
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Current</p>
                                                <p className="font-mono text-slate-300">{displayPrice.toFixed(2)}</p>
                                            </div>
                                        )}
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Leverage</p>
                                            <p className="font-mono text-slate-300">{trade.leverage}</p>
                                        </div>
                                        {trade.paper_notional_usd && (
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Notional</p>
                                                <p className="font-mono text-slate-300">{formatSignedUsd(trade.paper_notional_usd)}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Live PnL snapshots */}
                                    {trade.snapshots && Object.keys(trade.snapshots).length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-slate-700/40">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">PnL Timeline</p>
                                            <div className="space-y-2">
                                                {Object.entries(trade.snapshots)
                                                    .sort(([a], [b]) => a.localeCompare(b))
                                                    .map(([key, snap]) => (
                                                        <div key={key} className="flex items-center justify-between text-xs">
                                                            <span className="text-slate-500 font-mono">{snap.observed_at}</span>
                                                            <div className="flex items-center gap-4">
                                                                <span className="text-slate-400">
                                                                    Price: <span className="font-mono">{snap.observed_price.toFixed(2)}</span>
                                                                </span>
                                                                <span className={`font-mono font-bold ${snap.raw_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                    {snap.raw_return_pct >= 0 ? "+" : ""}{snap.raw_return_pct.toFixed(2)}%
                                                                </span>
                                                                <span className={`font-mono font-bold ${snap.leveraged_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                    {snap.leveraged_return_pct >= 0 ? "+" : ""}{snap.leveraged_return_pct.toFixed(2)}%
                                                                </span>
                                                                {snap.paper_pnl_usd && (
                                                                    <span className={`font-mono font-bold ${snap.paper_pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                        {formatSignedUsd(snap.paper_pnl_usd)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Closed Trades */}
            {closedTrades.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                        Closed Positions ({closedTrades.length})
                    </h3>
                    <div className="space-y-3">
                        {closedTrades.map((trade) => {
                            const close = trade.trade_close!;
                            return (
                                <div
                                    key={trade.id}
                                    className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3 opacity-70"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${trade.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                                {trade.action}
                                            </span>
                                            <span className="text-sm font-bold text-white">{trade.symbol}</span>
                                            <span className="text-xs text-slate-500 font-mono">#{trade.id}</span>
                                            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">Closed</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Entry</p>
                                            <p className="font-mono text-slate-300">{trade.entry_price.toFixed(2)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Close</p>
                                            <p className="font-mono text-slate-300">{close.closed_price.toFixed(2)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Return</p>
                                            <p className={`font-mono font-bold ${close.closed_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                {close.closed_return_pct >= 0 ? "+" : ""}{close.closed_return_pct.toFixed(2)}%
                                            </p>
                                        </div>
                                        {close.paper_pnl_usd !== undefined && (
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-slate-500">P&L</p>
                                                <p className={`font-mono font-bold ${close.paper_pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                    {formatSignedUsd(close.paper_pnl_usd)}
                                                </p>
                                            </div>
                                        )}
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Closed At</p>
                                            <p className="font-mono text-slate-400">{close.closed_at}</p>
                                        </div>
                                    </div>

                                    {close.notes && (
                                        <p className="text-xs text-slate-500 mt-2 italic">"{close.notes}"</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </GlassCard>
    );
}