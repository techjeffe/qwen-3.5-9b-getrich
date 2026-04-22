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

export default function SentimentTicker({ data }: SentimentTickerProps) {
    const getBlusterColor = (score: number) => {
        if (score < -0.5) return "text-red-400";
        if (score < 0) return "text-yellow-400";
        return "text-green-400";
    };

    const getPolicyColor = (score: number) => {
        if (score > 0.7) return "text-green-400 font-bold";
        if (score > 0.3) return "text-yellow-400";
        return "text-gray-400";
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gray-800 rounded-lg p-4 mb-6"
        >
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                Sentiment Analysis
            </h3>

            {Object.entries(data).map(([symbol, sentiment], index) => (
                <motion.div
                    key={symbol}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center justify-between py-3 border-b border-gray-700 last:border-0"
                >
                    <span className="font-bold text-lg">{symbol}</span>

                    <div className="flex items-center space-x-6">
                        <div className="text-right">
                            <p className="text-xs text-gray-500">Bluster Score</p>
                            <p className={`text-sm ${getBlusterColor(sentiment.market_bluster)}`}>
                                {sentiment.market_bluster.toFixed(2)}
                            </p>
                        </div>

                        <div className="text-right">
                            <p className="text-xs text-gray-500">Policy Score</p>
                            <p className={`text-sm ${getPolicyColor(sentiment.policy_change)}`}>
                                {sentiment.policy_change.toFixed(2)}
                            </p>
                        </div>

                        <div className="text-right">
                            <p className="text-xs text-gray-500">Confidence</p>
                            <p className="text-sm text-blue-400">
                                {(sentiment.confidence * 100).toFixed(0)}%
                            </p>
                        </div>
                    </div>
                </motion.div>
            ))}
        </motion.div>
    );
}
