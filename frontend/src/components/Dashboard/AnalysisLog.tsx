"use client";

import { useEffect, useRef } from "react";

interface AnalysisLogProps {
    logs: string[];
    isAnalyzing: boolean;
}

export default function AnalysisLog({ logs, isAnalyzing }: AnalysisLogProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    if (!isAnalyzing && logs.length === 0) return null;

    return (
        <div className="mt-6 bg-gray-950 border border-green-900 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-green-900 bg-gray-900">
                <span className="text-green-500 text-xs font-mono uppercase tracking-widest">
                    Analysis Log
                </span>
                {isAnalyzing && (
                    <span className="flex items-center gap-1.5 text-xs text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        Running
                    </span>
                )}
            </div>
            <div className="h-72 overflow-y-auto p-4 font-mono text-sm space-y-0.5 scroll-smooth">
                {logs.map((log, i) => {
                    const isHeader = log.startsWith("━━");
                    const isIndented = log.startsWith("  ");
                    return (
                        <div
                            key={i}
                            className={[
                                "leading-relaxed whitespace-pre-wrap break-all",
                                isHeader
                                    ? "text-green-500 font-semibold mt-2"
                                    : isIndented
                                    ? "text-green-400/80 pl-2"
                                    : "text-green-300",
                            ].join(" ")}
                        >
                            {!isHeader && (
                                <span className="text-green-700 select-none mr-2">›</span>
                            )}
                            {log}
                        </div>
                    );
                })}
                {isAnalyzing && (
                    <div className="flex gap-2 text-green-600">
                        <span className="select-none shrink-0">›</span>
                        <span className="animate-pulse">▋</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
