"use client";

import { motion } from "framer-motion";
import { Activity, Clock, CheckCircle2, AlertCircle } from "lucide-react";

interface AnalysisStatusCardProps {
    stageLabel: string;
    progressPct: number;
    elapsedSeconds: number;
    etaSeconds: number;
    latestMessage: string;
    isWaitingForStream: boolean;
    hasReliableHistory: boolean;
}

export default function AnalysisStatusCard({
    stageLabel,
    progressPct,
    elapsedSeconds,
    etaSeconds,
    latestMessage,
    isWaitingForStream,
    hasReliableHistory,
}: AnalysisStatusCardProps) {
    const mm = Math.floor(elapsedSeconds / 60);
    const ss = elapsedSeconds % 60;
    const etaMm = Math.floor(etaSeconds / 60);
    const etaSs = etaSeconds % 60;

    return (
        <div
            className="rounded-2xl p-6"
            style={{ background: "rgba(30,41,59,0.75)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
            <div className="flex items-center gap-3 mb-4">
                {isWaitingForStream ? (
                    <Activity size={18} className="animate-spin text-blue-400" />
                ) : progressPct >= 100 ? (
                    <CheckCircle2 size={18} className="text-emerald-400" />
                ) : (
                    <Clock size={18} className="text-yellow-400 animate-pulse" />
                )}
                <p className="text-sm font-semibold text-slate-200">{stageLabel}</p>
            </div>

            {/* Progress bar */}
            <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden mb-4">
                <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.5 }}
                />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Elapsed</p>
                    <p className="text-lg font-bold font-mono text-slate-300">
                        {mm}:{ss.toString().padStart(2, "0")}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">ETA</p>
                    <p className="text-lg font-bold font-mono text-slate-300">
                        {etaSeconds > 0 ? `${etaMm}:${etaSs.toString().padStart(2, "0")}` : "—"}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Progress</p>
                    <p className="text-lg font-bold font-mono text-slate-300">{Math.round(progressPct)}%</p>
                </div>
            </div>

            {/* Reliability indicator */}
            {hasReliableHistory && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 mb-3">
                    <CheckCircle2 size={10} />
                    <span>Based on recent analysis history</span>
                </div>
            )}

            {/* Latest message */}
            <div className="rounded-lg bg-slate-900/50 px-3 py-2 border border-slate-700/40">
                <p className="text-xs text-slate-400 font-mono">{latestMessage}</p>
            </div>
        </div>
    );
}