"use client";

import GlassCard from "./GlassCard";
import { PnLTrade } from "@/lib/types/analysis";
import { Prices } from "@/lib/types/analysis";
import { formatSignedUsd, paperPnlUsd, formatSignedScore } from "@/lib/utils/timing";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { useMemo } from "react";

interface TradeCardProps {
    trade: PnLTrade;
    prices: Prices | null;
    onCloseTrade: (tradeId: number, closedPrice: number, notes: string) => void;
}

export default function TradeCard({ trade, prices, onCloseTrade }: TradeCardProps) {
    const underlying = trade.underlying_symbol || trade.symbol;
    const isBuy = trade.action === "BUY";
    const currentPrice = prices?.[trade.symbol]?.price ?? prices?.[underlying]?.price;
    const snapshotEntry = trade.comparison;

    const pnlInfo = useMemo(() => {
        const rawReturn = currentPrice
            ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
            : null;
        const leveragedReturn = rawReturn !== null
            ? rawReturn * parseLeverage(trade.leverage)
            : null;
        const snapshotRecommended = snapshotEntry?.recommended_return_pct ?? null;
        const snapshotActual = snapshotEntry?.actual_return_pct ?? null;

        return {
            rawReturn,
            leveragedReturn,
            snapshotRecommended,
            snapshotActual,
            snapshotFollowingBetterPct: snapshotEntry?.following_was_better_pct ?? null,
            snapshotFollowingBetterUsd: snapshotEntry?.following_was_better_usd ?? null,
        };
    }, [currentPrice, snapshotEntry, trade.entry_price, trade.leverage]);

    const leverageMultiplier = parseLeverage(trade.leverage);

    return (
        <div className={`rounded-xl border p-4 ${
            isBuy
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-red-500/20 bg-red-500/5"
        }`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                    }`}>
                        {trade.action}
                    </span>
                    <span className="text-sm font-bold text-white">{underlying}</span>
                    <span className="text-xs text-slate-500 font-mono">#{trade.id}</span>
                </div>
                {snapshotEntry?.latest_horizon && (
                    <span className="text-[10px] text-slate-500 font-mono">{snapshotEntry.latest_horizon}</span>
                )}
            </div>

            {/* Prices */}
            <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                <div>
                    <span className="text-slate-500">Entry: </span>
                    <span className="font-mono font-bold text-slate-300">${trade.entry_price.toFixed(2)}</span>
                </div>
                {currentPrice && (
                    <div>
                        <span className="text-slate-500">Current: </span>
                        <span className="font-mono font-bold text-slate-300">${currentPrice.toFixed(2)}</span>
                    </div>
                )}
            </div>

            {/* Trade metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Leverage</p>
                    <p className="text-sm font-bold font-mono text-slate-300">{trade.leverage}</p>
                </div>
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Paper Shares</p>
                    <p className="text-sm font-bold font-mono text-slate-300">
                        {trade.paper_shares ?? "—"}
                    </p>
                </div>
                {trade.paper_notional_usd && (
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Notional</p>
                        <p className="text-sm font-bold font-mono text-blue-400">
                            {formatSignedUsd(trade.paper_notional_usd)}
                        </p>
                    </div>
                )}
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Rec. Return</p>
                    {snapshotEntry?.recommended_return_pct !== undefined ? (
                        <p className={`text-sm font-bold font-mono ${
                            snapshotEntry.recommended_return_pct >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}>
                            {formatSignedScore(snapshotEntry.recommended_return_pct)}
                        </p>
                    ) : (
                        <p className="text-sm font-bold font-mono text-slate-600">—</p>
                    )}
                </div>
            </div>

            {/* Actual execution data */}
            {trade.actual_execution && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 mb-3">
                    <p className="text-[10px] uppercase tracking-wider text-blue-300 mb-1">Actual Execution</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span className="text-slate-500">Price: </span>
                            <span className="font-mono font-bold text-blue-400">
                                ${trade.actual_execution.executed_price.toFixed(2)}
                            </span>
                        </div>
                        <div>
                            <span className="text-slate-500">At: </span>
                            <span className="font-mono text-slate-400">{trade.actual_execution.executed_at}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Comparison data */}
            {snapshotEntry && (
                <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2.5 mb-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Comparison</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                            <span className="text-slate-500">Rec. PnL: </span>
                            {snapshotEntry.recommended_paper_pnl_usd !== undefined ? (
                                <span className={`font-mono font-bold ${
                                    snapshotEntry.recommended_paper_pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"
                                }`}>
                                    {formatSignedUsd(snapshotEntry.recommended_paper_pnl_usd)}
                                </span>
                            ) : (
                                <span className="font-mono text-slate-600">—</span>
                            )}
                        </div>
                        <div>
                            <span className="text-slate-500">Actual PnL: </span>
                            {snapshotEntry.actual_paper_pnl_usd !== undefined ? (
                                <span className={`font-mono font-bold ${
                                    snapshotEntry.actual_paper_pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"
                                }`}>
                                    {formatSignedUsd(snapshotEntry.actual_paper_pnl_usd)}
                                </span>
                            ) : (
                                <span className="font-mono text-slate-600">—</span>
                            )}
                        </div>
                        <div>
                            <span className="text-slate-500">Follow (Pct): </span>
                            {snapshotEntry.following_was_better_pct !== undefined ? (
                                <span className={`font-mono font-bold ${
                                    snapshotEntry.following_was_better_pct >= 0 ? "text-emerald-400" : "text-red-400"
                                }`}>
                                    {formatSignedScore(snapshotEntry.following_was_better_pct)}
                                </span>
                            ) : (
                                <span className="font-mono text-slate-600">—</span>
                            )}
                        </div>
                        <div>
                            <span className="text-slate-500">Follow (USD): </span>
                            {snapshotEntry.following_was_better_usd !== undefined ? (
                                <span className={`font-mono font-bold ${
                                    snapshotEntry.following_was_better_usd >= 0 ? "text-emerald-400" : "text-red-400"
                                }`}>
                                    {formatSignedUsd(snapshotEntry.following_was_better_usd)}
                                </span>
                            ) : (
                                <span className="font-mono text-slate-600">—</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* PnL timeline */}
            {trade.snapshots && Object.keys(trade.snapshots).length > 0 && (
                <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">PnL Timeline</p>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {Object.entries(trade.snapshots)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .slice(-5)
                            .map(([key, snap]) => (
                                <div key={key} className="flex items-center justify-between text-[10px]">
                                    <span className="text-slate-500 font-mono">{snap.observed_at}</span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-400">
                                            ${snap.observed_price.toFixed(2)}
                                        </span>
                                        <span className={`font-mono font-bold ${
                                            snap.raw_return_pct >= 0 ? "text-emerald-400" : "text-red-400"
                                        }`}>
                                            {formatSignedScore(snap.raw_return_pct)}
                                        </span>
                                        {snap.leveraged_return_pct !== snap.raw_return_pct && (
                                            <span className={`font-mono font-bold ${
                                                snap.leveraged_return_pct >= 0 ? "text-emerald-400" : "text-red-400"
                                            }`}>
                                                {formatSignedScore(snap.leveraged_return_pct)}
                                            </span>
                                        )}
                                        {snap.paper_pnl_usd !== undefined && (
                                            <span className={`font-mono font-bold ${
                                                snap.paper_pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"
                                            }`}>
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
}

function parseLeverage(leverage: string): number {
    const match = leverage.match(/(\d+)x/);
    if (match) return parseInt(match[1], 10);
    const negativeMatch = leverage.match(/-(\d+)x/);
    if (negativeMatch) return -parseInt(negativeMatch[1], 10);
    return 1;
}