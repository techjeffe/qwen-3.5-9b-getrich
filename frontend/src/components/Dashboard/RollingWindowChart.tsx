"use client";

import { motion } from "framer-motion";

interface BacktestResults {
    total_return: number;
    annualized_return: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
    total_trades: number;
    lookback_days: number;
    walk_forward_steps: number;
}

interface RollingWindowChartProps {
    backtestResults: BacktestResults | null;
    lookbackDays: number;
}

export default function RollingWindowChart({ backtestResults, lookbackDays }: RollingWindowChartProps) {
    if (!backtestResults) return null;

    const getMetricColor = (value: number, type: string) => {
        switch (type) {
            case "return":
                return value > 0 ? "text-green-400" : "text-red-400";
            case "sharpe":
                return value > 1 ? "text-green-400" : value < -1 ? "text-red-400" : "text-yellow-400";
            case "drawdown":
                return value < 0 ? "text-green-400" : "text-red-400";
            case "winrate":
                return value > 50 ? "text-green-400" : value < 30 ? "text-red-400" : "text-yellow-400";
            default:
                return "text-white";
        }
    };

    const formatNumber = (num: number, decimals: number = 2) => {
        if (Math.abs(num) < 0.01 && num !== 0) return `${num.toFixed(decimals)}%`;
        return num.toFixed(decimals);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gray-800 rounded-lg p-4 mb-6"
        >
            <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">
                Rolling Window Backtest Results ({lookbackDays}-day lookback)
            </h3>

            {/* Performance Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Total Return</p>
                    <p className={`text-lg font-bold ${getMetricColor(backtestResults.total_return, "return")}`}>
                        {formatNumber(backtestResults.total_return)}
                    </p>
                </div>

                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Sharpe Ratio</p>
                    <p className={`text-lg font-bold ${getMetricColor(backtestResults.sharpe_ratio, "sharpe")}`}>
                        {backtestResults.sharpe_ratio.toFixed(2)}
                    </p>
                </div>

                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Max Drawdown</p>
                    <p className={`text-lg font-bold ${getMetricColor(backtestResults.max_drawdown, "drawdown")}`}>
                        {formatNumber(backtestResults.max_drawdown)}
                    </p>
                </div>

                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                    <p className={`text-lg font-bold ${getMetricColor(backtestResults.win_rate, "winrate")}`}>
                        {backtestResults.win_rate.toFixed(0)}%
                    </p>
                </div>
            </div>

            {/* Walk-Forward Visualization */}
            <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2">Walk-Forward Windows</p>
                <div className="flex items-center space-x-1">
                    {Array.from({ length: Math.min(backtestResults.walk_forward_steps, 10) }).map((_, i) => (
                        <motion.div
                            key={i}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                            className={`w-2 h-2 rounded-full ${i === backtestResults.walk_forward_steps - 1 ? "bg-green-500" : "bg-gray-600"}`}
                        />
                    ))}
                    {backtestResults.walk_forward_steps > 10 && (
                        <span className="text-xs text-gray-500">+{backtestResults.walk_forward_steps - 10} more</span>
                    )}
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Trades</p>
                    <p className="text-lg font-bold text-white">{backtestResults.total_trades}</p>
                </div>

                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Lookback</p>
                    <p className="text-lg font-bold text-white">{lookbackDays} days</p>
                </div>

                <div className="p-3 bg-gray-700/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Leverage</p>
                    <p className="text-lg font-bold text-white">3x</p>
                </div>
            </div>
        </motion.div>
    );
}
