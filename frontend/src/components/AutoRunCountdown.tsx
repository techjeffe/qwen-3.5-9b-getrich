"use client";

import { Clock } from "lucide-react";
import { useAnalysis } from "@/lib/context/AnalysisContext";

export default function AutoRunCountdown() {
    const { countdown, isAnalyzing, config, configLoaded } = useAnalysis();

    if (!configLoaded || !config.auto_run_enabled) return null;

    const mm = Math.floor(countdown / 60);
    const ss = countdown % 60;

    return (
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={11} />
            <span>
                {isAnalyzing
                    ? "Analyzing..."
                    : `Auto-run in ${mm}:${ss.toString().padStart(2, "0")}`}
            </span>
        </div>
    );
}