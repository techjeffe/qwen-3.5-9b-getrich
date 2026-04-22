"use client";

import { useState } from "react";
import { ArrowRight, Activity, TrendingUp, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SingleButtonProps {
    onAnalyze: () => void;
    isAnalyzing: boolean;
    result: any;
}

export default function SingleButton({ onAnalyze, isAnalyzing, result }: SingleButtonProps) {
    const [isHovered, setIsHovered] = useState(false);

    const getSignalColor = (signalType: string) => {
        switch (signalType) {
            case "LONG": return "text-green-400 border-green-400 bg-green-400/10";
            case "SHORT": return "text-red-400 border-red-400 bg-red-400/10";
            default: return "text-gray-400 border-gray-400 bg-gray-400/10";
        }
    };

    const getUrgencyColor = (urgency: string) => {
        switch (urgency) {
            case "HIGH": return "bg-red-500";
            case "MEDIUM": return "bg-yellow-500";
            default: return "bg-gray-500";
        }
    };

    const getUrgencyText = (urgency: string) => {
        switch (urgency) {
            case "HIGH": return "text-red-400 font-bold";
            case "MEDIUM": return "text-yellow-400";
            default: return "text-gray-400";
        }
    };

    return (
        <div className="flex flex-col items-center">
            {/* Signal Display */}
            {result && result.trading_signal && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mb-4 px-6 py-3 rounded-lg border-2 ${getSignalColor(result.trading_signal.signal_type)}`}
                >
                    <div className="flex items-center space-x-3">
                        {result.trading_signal.signal_type === "LONG" ? (
                            <TrendingUp size={24} />
                        ) : result.trading_signal.signal_type === "SHORT" ? (
                            <AlertTriangle size={24} />
                        ) : (
                            <Activity size={24} />
                        )}
                        <div>
                            <p className="text-sm text-gray-400">Signal</p>
                            <p className={`text-xl font-bold ${getUrgencyText(result.trading_signal.urgency)}`}>
                                {result.trading_signal.signal_type}
                            </p>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Main Button */}
            <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={onAnalyze}
                disabled={isAnalyzing}
                className={`
          relative overflow-hidden px-12 py-6 rounded-xl font-bold text-xl tracking-wider
          transition-all duration-300
          ${isAnalyzing
                        ? "bg-gray-600 cursor-not-allowed"
                        : isHovered && !isAnalyzing
                            ? "bg-green-500 shadow-lg shadow-green-500/50"
                            : "bg-green-600 hover:bg-green-500"
                    }
          text-white
        `}
            >
                <AnimatePresence mode="wait">
                    {isAnalyzing ? (
                        <motion.span
                            key="analyzing"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center space-x-3"
                        >
                            <Activity className="animate-spin" size={24} />
                            <span>ANALYZING MARKET...</span>
                        </motion.span>
                    ) : result ? (
                        <motion.span
                            key="analyze"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center space-x-3"
                        >
                            <span>TRIGGER TRADE</span>
                            <ArrowRight size={24} />
                        </motion.span>
                    ) : (
                        <motion.span
                            key="ready"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center space-x-3"
                        >
                            <span>ANALYZE MARKET</span>
                            <ArrowRight size={24} />
                        </motion.span>
                    )}
                </AnimatePresence>

                {/* Button Glow Effect */}
                {!isAnalyzing && isHovered && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
                )}
            </motion.button>

            {/* Confidence Display */}
            {result && result.trading_signal && (
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4 text-sm text-gray-400"
                >
                    Confidence: {(result.trading_signal.confidence_score * 100).toFixed(0)}%
                </motion.p>
            )}
        </div>
    );
}
