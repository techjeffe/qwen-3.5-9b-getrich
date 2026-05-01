"use client";

import GlassCard from "./GlassCard";
import { Recommendation, PnLTrade } from "@/lib/types/analysis";
import { RedTeamReview } from "@/lib/types/analysis";
import { SentimentEntry } from "@/lib/types/analysis";
import RecommendationBadge from "./RecommendationBadge";
import RecommendationTooltip from "./RecommendationTooltip";
import { formatSignedScore } from "@/lib/utils/timing";
import { signalColor, signalBadge } from "@/lib/utils/formatters";
import { ChevronDown, ChevronUp, Shield } from "lucide-react";
import { useState } from "react";

interface SignalHeroProps {
    signal: any;
    redTeamReview: RedTeamReview | null | undefined;
    sentimentScores: Record<string, SentimentEntry>;
    trackedSymbols: string[];
    trackedTrades: PnLTrade[];
    onRecommendationClick: (rec: Recommendation) => void;
}

export default function SignalHero({
    signal,
    redTeamReview,
    sentimentScores,
    trackedSymbols,
    trackedTrades,
    onRecommendationClick,
}: SignalHeroProps) {
    const [showRedTeam, setShowRedTeam] = useState(false);

    if (!signal) return null;

    const recommendations: Recommendation[] = signal.recommendations ?? [];
    const overallSignal = signal.signal_type || "HOLD";
    const confidenceScore = signal.confidence_score ?? 0;

    return (
        <GlassCard>
            {/* Hero Signal */}
            <div className="text-center mb-6">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500 mb-2">Overall Trading Signal</p>
                <div className="flex items-center justify-center gap-3 mb-2">
                    <span className={`text-5xl font-black ${signalColor(overallSignal)}`}>{overallSignal}</span>
                    <span className={`text-sm font-bold px-3 py-1 rounded-lg border ${signalBadge(overallSignal)}`}>
                        {Math.round(confidenceScore * 100)}% confidence
                    </span>
                </div>
                {signal.summary && (
                    <p className="text-sm text-slate-400 max-w-2xl mx-auto mt-2">{signal.summary}</p>
                )}
            </div>

            {/* Recommendations Grid */}
            {recommendations.length > 0 && (
                <div className="mb-6">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Recommendations</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {recommendations.map((rec, idx) => {
                            const underlying = rec.underlying_symbol || rec.symbol;
                            const isShort = rec.thesis === "SHORT" || rec.action === "SELL";
                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => onRecommendationClick(rec)}
                                    className={`text-left rounded-xl border p-4 transition-colors hover:bg-slate-800/40 ${
                                        isShort
                                            ? "border-red-500/20 bg-red-500/5"
                                            : "border-emerald-500/20 bg-emerald-500/5"
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-lg font-bold text-white">{underlying}</span>
                                        <RecommendationBadge action={rec.action} />
                                    </div>
                                    <p className="text-xs text-slate-400">{rec.leverage}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Sentiment Scores */}
            <div className="mb-6">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Sentiment Scores</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {trackedSymbols.map((symbol) => {
                        const sent = sentimentScores[symbol];
                        if (!sent) {
                            return (
                                <div key={symbol} className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                                    <p className="text-xs font-bold text-slate-500">{symbol}</p>
                                    <p className="text-[10px] text-slate-600">No data</p>
                                </div>
                            );
                        }
                        const pos = sent.market_bluster >= 0;
                        return (
                            <div key={symbol} className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                                <p className="text-xs font-bold text-slate-300">{symbol}</p>
                                <div className="mt-1 space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Bluster</span>
                                        <span className={`font-mono font-bold ${pos ? "text-emerald-400" : "text-red-400"}`}>
                                            {formatSignedScore(sent.market_bluster)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Policy</span>
                                        <span className={`font-mono font-bold ${sent.policy_change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {formatSignedScore(sent.policy_change)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-slate-500">Confidence</span>
                                        <span className="font-mono font-bold text-blue-400">
                                            {Math.round(sent.confidence * 100)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Red Team Review */}
            {redTeamReview && redTeamReview.symbol_reviews && redTeamReview.symbol_reviews.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowRedTeam(!showRedTeam)}
                        className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                    >
                        <Shield size={14} />
                        <span>Red Team Review</span>
                        {showRedTeam ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {showRedTeam && (
                        <div className="mt-3 space-y-3">
                            <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
                                <p className="text-xs text-slate-400 mb-2">{redTeamReview.summary}</p>
                                {redTeamReview.portfolio_risks && redTeamReview.portfolio_risks.length > 0 && (
                                    <ul className="space-y-1">
                                        {redTeamReview.portfolio_risks.map((risk, idx) => (
                                            <li key={idx} className="text-xs text-slate-500">• {risk}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {redTeamReview.symbol_reviews.map((review, idx) => (
                                <div key={idx} className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-bold text-white">{review.symbol}</span>
                                        <RecommendationBadge action={review.adjusted_signal === "HOLD" ? (review.current_recommendation === "BUY" ? "SELL" : "BUY") : (review.adjusted_signal as "BUY" | "SELL")} />
                                    </div>
                                    <p className="text-xs text-slate-400 mb-2">{review.rationale}</p>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div>
                                            <span className="text-slate-500">Stop Loss: </span>
                                            <span className="font-mono text-red-400">{review.stop_loss_pct}%</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">Urgency: </span>
                                            <span className={`font-mono font-bold ${
                                                review.adjusted_urgency === "HIGH" ? "text-red-400" :
                                                review.adjusted_urgency === "MEDIUM" ? "text-yellow-400" : "text-slate-400"
                                            }`}>{review.adjusted_urgency}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </GlassCard>
    );
}