"use client";

import { motion } from "framer-motion";

interface SentimentData {
    market_bluster: number;
    policy_change: number;
    confidence: number;
    reasoning: string;
}

interface SentimentTickerProps {
    data: Record<string, SentimentData>;
}

function ScoreBar({ value, min = -1, max = 1, positiveColor = "bg-green-500", negativeColor = "bg-red-500" }: {
    value: number; min?: number; max?: number; positiveColor?: string; negativeColor?: string;
}) {
    const range = max - min;
    const zeroPct = ((0 - min) / range) * 100;
    const valuePct = ((value - min) / range) * 100;
    const isPositive = value >= 0;
    const left = isPositive ? zeroPct : valuePct;
    const width = Math.abs(valuePct - zeroPct);

    return (
        <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
            {/* zero line */}
            {min < 0 && (
                <div className="absolute top-0 bottom-0 w-px bg-gray-500" style={{ left: `${zeroPct}%` }} />
            )}
            <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className={`absolute top-0 bottom-0 rounded-full ${isPositive ? positiveColor : negativeColor}`}
                style={{ left: `${left}%` }}
            />
        </div>
    );
}

export default function SentimentTicker({ data }: SentimentTickerProps) {
    if (!data || Object.keys(data).length === 0) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gray-800 rounded-xl p-5 mb-6 border border-gray-700"
        >
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
                Sentiment Analysis
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(data).map(([symbol, s], i) => (
                    <motion.div
                        key={symbol || `sentiment-${i}`}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-lg font-black text-white">{symbol}</span>
                            <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                                {Math.round(s.confidence * 100)}% confidence
                            </span>
                        </div>

                        {/* Bluster */}
                        <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span>Market Bluster</span>
                                <span className={s.market_bluster < -0.5 ? "text-red-400" : s.market_bluster < 0 ? "text-yellow-400" : "text-green-400"}>
                                    {s.market_bluster > 0 ? "+" : ""}{s.market_bluster.toFixed(2)}
                                </span>
                            </div>
                            <ScoreBar value={s.market_bluster} min={-1} max={1} positiveColor="bg-green-500" negativeColor="bg-red-500" />
                            <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                                <span>bluster</span><span>neutral</span><span>calm</span>
                            </div>
                        </div>

                        {/* Policy */}
                        <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span>Policy Change</span>
                                <span className={s.policy_change > 0.7 ? "text-green-400 font-bold" : s.policy_change > 0.3 ? "text-yellow-400" : "text-gray-400"}>
                                    {s.policy_change.toFixed(2)}
                                </span>
                            </div>
                            <ScoreBar value={s.policy_change} min={0} max={1} positiveColor="bg-blue-500" negativeColor="bg-gray-500" />
                            <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                                <span>rhetoric</span><span>possible</span><span>concrete</span>
                            </div>
                        </div>

                        {/* Reasoning */}
                        {s.reasoning && (
                            <p className="text-xs text-gray-400 italic leading-relaxed border-l-2 border-gray-600 pl-2">
                                {s.reasoning.length > 180 ? s.reasoning.slice(0, 180) + "…" : s.reasoning}
                            </p>
                        )}
                    </motion.div>
                ))}
            </div>
        </motion.div>
    );
}
