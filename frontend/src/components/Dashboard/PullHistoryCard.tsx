"use client";

import GlassCard from "./GlassCard";
import { AnalysisSnapshotItem } from "@/lib/types/analysis";
import { formatSnapshotLabel } from "@/lib/utils/formatters";
import { LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY } from "@/lib/constants/analysis";
import { useMemo, useState } from "react";

interface PullHistoryCardProps {
    snapshots: AnalysisSnapshotItem[];
    currentRequestId: string | undefined;
}

export default function PullHistoryCard({ snapshots, currentRequestId }: PullHistoryCardProps) {
    const [viewingId, setViewingId] = useState<string | null>(null);

    const sortedSnapshots = useMemo(() => {
        return [...snapshots].sort((a, b) => {
            if (!a.timestamp) return 1;
            if (!b.timestamp) return -1;
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });
    }, [snapshots]);

    const isCurrent = (id: string) => id === currentRequestId;
    const isLastViewed = (id: string) =>
        typeof window !== "undefined" && localStorage.getItem(LAST_VIEWED_ANALYSIS_REQUEST_ID_KEY) === id;

    return (
        <GlassCard>
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Analysis History</h2>

            {sortedSnapshots.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No saved analyses yet.</p>
            ) : (
                <div className="space-y-2">
                    {sortedSnapshots.map((snapshot) => {
                        const current = isCurrent(snapshot.request_id);
                        const lastViewed = isLastViewed(snapshot.request_id);
                        const expanded = viewingId === snapshot.request_id;

                        return (
                            <div
                                key={snapshot.request_id}
                                className={`rounded-xl border p-3 transition-colors cursor-pointer ${
                                    current
                                        ? "border-blue-500/40 bg-blue-500/10"
                                        : lastViewed
                                        ? "border-yellow-500/30 bg-yellow-500/5"
                                        : "border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50"
                                }`}
                                onClick={() => setViewingId(expanded ? null : snapshot.request_id)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {current && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                                CURRENT
                                            </span>
                                        )}
                                        {lastViewed && !current && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">
                                                LAST VIEWED
                                            </span>
                                        )}
                                        <span className="text-xs font-mono text-slate-300">
                                            {snapshot.request_id.slice(0, 8)}...
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-slate-500">
                                        {snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleString() : "Unknown"}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[10px]">
                                    <div>
                                        <span className="text-slate-500">Model: </span>
                                        <span className="font-mono text-slate-300">{snapshot.model_name}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Symbols: </span>
                                        <span className="font-mono text-slate-300">{snapshot.symbols.join(", ")}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Articles: </span>
                                        <span className="font-mono text-slate-300">{snapshot.posts_scraped}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Signal: </span>
                                        <span className={`font-mono font-bold ${
                                            snapshot.signal_type === "LONG" ? "text-emerald-400" :
                                            snapshot.signal_type === "SHORT" ? "text-red-400" :
                                            "text-slate-400"
                                        }`}>
                                            {snapshot.signal_type || "HOLD"}
                                        </span>
                                    </div>
                                </div>

                                {expanded && snapshot.recommendations && snapshot.recommendations.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-700/40">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Recommendations</p>
                                        <div className="space-y-1">
                                            {snapshot.recommendations.map((rec, idx) => (
                                                <div key={idx} className="flex items-center gap-2 text-xs">
                                                    <span className={`font-bold ${
                                                        rec.action === "BUY" ? "text-emerald-400" : "text-red-400"
                                                    }`}>{rec.action}</span>
                                                    <span className="font-mono text-slate-300">{rec.symbol}</span>
                                                    <span className="text-slate-500">{rec.leverage}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </GlassCard>
    );
}