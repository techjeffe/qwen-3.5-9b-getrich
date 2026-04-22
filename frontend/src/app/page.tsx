"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Activity, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";
import SingleButton from "@/components/Dashboard/SingleButton";
import SentimentTicker from "@/components/Dashboard/SentimentTicker";
import RiskGauge from "@/components/Dashboard/RiskGauge";
import RollingWindowChart from "@/components/Dashboard/RollingWindowChart";

export default function Home() {
    const [analysisResult, setAnalysisResult] = useState<any>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyze = async () => {
        setIsAnalyzing(true);
        setError(null);

        try {
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    symbols: ["USO", "BITO"],
                    max_posts: 50,
                    include_backtest: true,
                    lookback_days: 14,
                }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            const data = await response.json();
            setAnalysisResult(data);
        } catch (err: any) {
            setError(err.message || "Failed to analyze market");
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white">
            {/* Header */}
            <header className="bg-gray-800 border-b border-gray-700">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-green-400">
                        3x Sentiment Trading System
                    </h1>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-400">
                            {analysisResult ? "Analysis Complete" : "Ready to Analyze"}
                        </span>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 py-6">
                {/* Sentiment Ticker */}
                {analysisResult && (
                    <SentimentTicker data={analysisResult.sentiment_scores} />
                )}

                {/* Error Display */}
                {error && (
                    <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg">
                        <div className="flex items-center space-x-2 text-red-300">
                            <AlertTriangle size={20} />
                            <span>{error}</span>
                        </div>
                    </div>
                )}

                {/* Risk Gauge */}
                {analysisResult && (
                    <RiskGauge
                        signalType={analysisResult.trading_signal?.signal_type || "HOLD"}
                        confidence={analysisResult.trading_signal?.confidence_score || 0}
                        urgency={analysisResult.trading_signal?.urgency || "LOW"}
                    />
                )}

                {/* Rolling Window Chart */}
                {analysisResult && (
                    <RollingWindowChart
                        backtestResults={analysisResult.backtest_results}
                        lookbackDays={14}
                    />
                )}

                {/* Single Button Dashboard */}
                <div className="mt-8">
                    <SingleButton
                        onAnalyze={handleAnalyze}
                        isAnalyzing={isAnalyzing}
                        result={analysisResult}
                    />
                </div>

                {/* Status Summary */}
                {analysisResult && (
                    <div className="mt-6 p-4 bg-gray-800 rounded-lg">
                        <h2 className="text-lg font-semibold mb-3 flex items-center">
                            <Activity size={20} className="mr-2 text-blue-400" />
                            Analysis Summary
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-3 bg-gray-700/50 rounded">
                                <p className="text-sm text-gray-400">Posts Analyzed</p>
                                <p className="text-xl font-bold">{analysisResult.posts_scraped}</p>
                            </div>
                            <div className="p-3 bg-gray-700/50 rounded">
                                <p className="text-sm text-gray-400">Processing Time</p>
                                <p className="text-xl font-bold">
                                    {(analysisResult.processing_time_ms / 1000).toFixed(2)}s
                                </p>
                            </div>
                            <div className="p-3 bg-gray-700/50 rounded">
                                <p className="text-sm text-gray-400">Signal</p>
                                <p className="text-xl font-bold text-green-400">
                                    {analysisResult.trading_signal?.signal_type || "HOLD"}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="mt-8 py-4 text-center text-gray-500 text-sm">
                <p>3x Leveraged Sentiment Trading System v1.0</p>
                <p className="text-xs mt-1">
                    Disclaimer: This system is for educational purposes only. Trading leveraged ETFs involves significant risk.
                </p>
            </footer>
        </div>
    );
}
