"use client";

import { motion } from "framer-motion";

interface RiskGaugeProps {
    signalType: string;
    confidence: number;
    urgency: string;
}

export default function RiskGauge({ signalType, confidence, urgency }: RiskGaugeProps) {
    const getRiskLevel = (signalType: string) => {
        if (signalType === "LONG") return "LOW";
        if (signalType === "SHORT") return "HIGH";
        return "NEUTRAL";
    };

    const getUrgencyColor = () => {
        switch (urgency) {
            case "HIGH": return "bg-red-500 shadow-red-500/50";
            case "MEDIUM": return "bg-yellow-500 shadow-yellow-500/50";
            default: return "bg-gray-500 shadow-gray-500/50";
        }
    };

    const getRiskColor = (level: string) => {
        switch (level) {
            case "HIGH": return "text-red-400 border-red-400 bg-red-400/10";
            case "LOW": return "text-green-400 border-green-400 bg-green-400/10";
            default: return "text-blue-400 border-blue-400 bg-blue-400/10";
        }
    };

    const getRiskIcon = (level: string) => {
        switch (level) {
            case "HIGH": return "⚠️";
            case "LOW": return "✅";
            default: return "➡️";
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-800 rounded-lg p-4 mb-6"
        >
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                Risk Assessment
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Signal Type */}
                <div className={`p-3 rounded-lg border-2 ${getRiskColor(getRiskLevel(signalType))}`}>
                    <p className="text-xs text-gray-500 mb-1">Risk Level</p>
                    <p className="text-xl font-bold">{getRiskIcon(getRiskLevel(signalType))} {getRiskLevel(signalType)}</p>
                </div>

                {/* Confidence */}
                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Confidence</p>
                    <p className="text-xl font-bold text-blue-400">{(confidence * 100).toFixed(0)}%</p>
                </div>

                {/* Urgency */}
                <div className={`p-3 rounded-lg border-2 ${getUrgencyColor()}`}>
                    <p className="text-xs text-gray-500 mb-1">Urgency</p>
                    <p className="text-xl font-bold">{urgency}</p>
                </div>
            </div>

            {/* Visual Gauge */}
            <div className="mt-4 flex items-center justify-center space-x-2">
                {[0, 1, 2, 3, 4].map((bar) => (
                    <motion.div
                        key={bar}
                        initial={{ height: 0 }}
                        animate={{ height: bar < confidence * 5 ? "8px" : "4px" }}
                        transition={{ delay: bar * 0.1 }}
                        className={`flex-1 rounded ${bar < confidence * 5 ? "bg-green-500" : "bg-gray-600"}`}
                    />
                ))}
            </div>
        </motion.div>
    );
}
