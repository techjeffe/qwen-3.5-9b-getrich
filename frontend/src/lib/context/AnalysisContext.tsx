"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { AppConfig, AnalysisResult } from "@/lib/types/analysis";
import { DEFAULT_APP_CONFIG } from "@/lib/constants/analysis";

// ─── Context type ──────────────────────────────────────────────────────────────

interface AnalysisContextValue {
    countdown: number;
    isAnalyzing: boolean;
    config: AppConfig;
    configLoaded: boolean;
    triggerAnalysis: () => void;
    resetCountdown: () => void;
    /** The latest completed analysis result, updated when the auto-run finishes */
    latestResult: AnalysisResult | null;
}

const AnalysisContext = createContext<AnalysisContextValue>({
    countdown: 0,
    isAnalyzing: false,
    config: DEFAULT_APP_CONFIG,
    configLoaded: false,
    triggerAnalysis: () => { },
    resetCountdown: () => { },
    latestResult: null,
});

export function useAnalysis() {
    return useContext(AnalysisContext);
}

// ─── Provider ──────────────────────────────────────────────────────────────────

export function AnalysisProvider({ children }: { children: React.ReactNode }) {
    const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
    const [configLoaded, setConfigLoaded] = useState(false);
    const [countdown, setCountdown] = useState(DEFAULT_APP_CONFIG.auto_run_interval_minutes * 60);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [latestResult, setLatestResult] = useState<AnalysisResult | null>(null);

    const countdownRef = useRef(countdown);
    const isAnalyzingRef = useRef(false);
    const configRef = useRef(config);

    useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);
    useEffect(() => { countdownRef.current = countdown; }, [countdown]);
    useEffect(() => { configRef.current = config; }, [config]);

    // ── Fetch config ──────────────────────────────────────────────────────────

    const fetchConfig = useCallback(async () => {
        try {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const nextConfig = await response.json() as AppConfig;
            setConfig(nextConfig);
            const intervalSecs = Math.max(1, nextConfig.auto_run_interval_minutes * 60);
            const nextCountdown = nextConfig.seconds_until_next_auto_run ?? intervalSecs;
            countdownRef.current = nextCountdown;
            setCountdown(nextCountdown);
            setConfigLoaded(true);
        } catch { /* best effort */ }
    }, []);

    useEffect(() => {
        void fetchConfig();
        const id = setInterval(fetchConfig, 60_000); // re-fetch config periodically
        return () => clearInterval(id);
    }, [fetchConfig]);

    // ── Trigger analysis (consume SSE stream, extract result) ─────────────────

    const triggerAnalysis = useCallback(async () => {
        if (isAnalyzingRef.current) return;
        setIsAnalyzing(true);
        try {
            const response = await fetch("/api/analyze/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbols: configRef.current.tracked_symbols,
                    max_posts: configRef.current.max_posts,
                    lookback_days: configRef.current.lookback_days,
                }),
            });
            if (!response.ok || !response.body) {
                console.error("Auto-run analysis failed:", response.statusText);
                return;
            }

            // Consume the SSE stream so the backend processes fully, and capture the result event.
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === "result") {
                            setLatestResult(event.data);
                        }
                    } catch { /* malformed */ }
                }
            }
        } catch (err) {
            console.error("Auto-run analysis failed:", err);
        } finally {
            setIsAnalyzing(false);
            // Reset countdown
            const intervalSecs = Math.max(1, configRef.current.auto_run_interval_minutes * 60);
            countdownRef.current = intervalSecs;
            setCountdown(intervalSecs);
            // Re-fetch config to get updated state (e.g. seconds_until_next_auto_run)
            void fetchConfig();
        }
    }, [fetchConfig]);

    // ── Auto-run countdown timer ──────────────────────────────────────────────

    useEffect(() => {
        if (!configLoaded || !config.auto_run_enabled) return;
        const intervalSecs = config.auto_run_interval_minutes * 60;
        const tick = setInterval(() => {
            if (isAnalyzingRef.current) return;
            const c = countdownRef.current;
            if (c <= 1) {
                countdownRef.current = intervalSecs;
                setCountdown(intervalSecs);
                void triggerAnalysis();
            } else {
                countdownRef.current = c - 1;
                setCountdown(c - 1);
            }
        }, 1000);
        return () => clearInterval(tick);
    }, [config.auto_run_enabled, config.auto_run_interval_minutes, configLoaded, triggerAnalysis]);

    const resetCountdown = useCallback(() => {
        const intervalSecs = Math.max(1, configRef.current.auto_run_interval_minutes * 60);
        countdownRef.current = intervalSecs;
        setCountdown(intervalSecs);
    }, []);

    return (
        <AnalysisContext.Provider value={{ countdown, isAnalyzing, config, configLoaded, triggerAnalysis, resetCountdown, latestResult }}>
            {children}
        </AnalysisContext.Provider>
    );
}