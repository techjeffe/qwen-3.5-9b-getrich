"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, ShieldAlert, Target, Zap } from "lucide-react";

interface TradingSignal {
    signal_type: "LONG" | "SHORT" | "HOLD";
    confidence_score: number;
    entry_symbol: string;
    entry_price?: number;
    stop_loss_pct: number;
    take_profit_pct: number;
    position_size_usd?: number;
    urgency: "LOW" | "MEDIUM" | "HIGH";
}

interface SignalCardProps {
    signal: TradingSignal;
    processingTimeMs: number;
    requestId: string;
}

const SIGNAL_CONFIG = {
    LONG:  { border: "border-green-500",  bg: "bg-green-500/10",  text: "text-green-400",  label: "GO LONG",  Icon: TrendingUp },
    SHORT: { border: "border-red-500",    bg: "bg-red-500/10",    text: "text-red-400",    label: "GO SHORT", Icon: TrendingDown },
    HOLD:  { border: "border-gray-500",   bg: "bg-gray-500/10",   text: "text-gray-300",   label: "HOLD",     Icon: Minus },
};

const URGENCY_COLOR = {
    HIGH:   "text-red-400 bg-red-400/10 border-red-400/30",
    MEDIUM: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    LOW:    "text-gray-400 bg-gray-400/10 border-gray-400/30",
};

export default function SignalCard({ signal, processingTimeMs, requestId }: SignalCardProps) {
    const cfg = SIGNAL_CONFIG[signal.signal_type];
    const { Icon } = cfg;
    const pct = Math.round(signal.confidence_score * 100);

    return (
        <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} p-6 mb-6`}
        >
            {/* Top row: signal + meta */}
            <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-lg ${cfg.bg} border ${cfg.border}`}>
                        <Icon size={32} className={cfg.text} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase tracking-widest mb-0.5">Signal</p>
                        <p className={`text-4xl font-black tracking-tight ${cfg.text}`}>{cfg.label}</p>
                    </div>
                </div>
                <div className="text-right text-xs text-gray-500 space-y-1">
                    <p>ID: {requestId}</p>
                    <p>{(processingTimeMs / 1000).toFixed(2)}s</p>
                    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${URGENCY_COLOR[signal.urgency]}`}>
                        {signal.urgency} URGENCY
                    </span>
                </div>
            </div>

            {/* Confidence bar */}
            <div className="mb-5">
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                    <span>Confidence</span>
                    <span className={`font-bold ${cfg.text}`}>{pct}%</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className={`h-full rounded-full ${signal.signal_type === "LONG" ? "bg-green-500" : signal.signal_type === "SHORT" ? "bg-red-500" : "bg-gray-500"}`}
                    />
                </div>
            </div>

            {/* Trade params */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-800/60 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                        <Target size={12} /> Entry
                    </div>
                    <p className="text-lg font-bold text-white">{signal.entry_symbol}</p>
                    {signal.entry_price && (
                        <p className="text-xs text-gray-500">${signal.entry_price.toFixed(2)}</p>
                    )}
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                        <ShieldAlert size={12} /> Stop Loss
                    </div>
                    <p className="text-lg font-bold text-red-400">−{signal.stop_loss_pct}%</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                        <Zap size={12} /> Take Profit
                    </div>
                    <p className="text-lg font-bold text-green-400">+{signal.take_profit_pct}%</p>
                </div>
            </div>
        </motion.div>
    );
}
