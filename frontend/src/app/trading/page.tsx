"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import {
    TrendingUp, TrendingDown, Minus, RefreshCw, Trash2,
    DollarSign, BarChart2, Activity,
} from "lucide-react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type MarketStatus = {
    status: "open" | "pre-market" | "after-hours" | "closed";
    label: string;
    tradeable: boolean;
};

type Summary = {
    total_trades: number;
    open_positions: number;
    closed_trades: number;
    total_deployed: number;
    realized_pnl: number;
    open_pnl: number;
    total_pnl: number;
    total_pnl_pct: number;
    win_count: number;
    loss_count: number;
    win_rate: number;
    avg_win: number;
    avg_loss: number;
};

type OpenPosition = {
    id: number;
    underlying: string;
    execution_ticker: string;
    signal_type: "LONG" | "SHORT";
    leverage: string;
    amount: number;
    shares: number;
    entry_price: number;
    current_price: number;
    entered_at: string;
    market_session: string;
    unrealized_pnl: number;
    unrealized_pnl_pct: number;
    conviction_level: "HIGH" | "MEDIUM" | "LOW" | null;
    trading_type: "POSITION" | "SWING" | "VOLATILE_EVENT" | "SCALP" | null;
    holding_period_hours: number | null;
    holding_window_until: string | null;
    window_active: boolean;
    window_remaining_minutes: number | null;
};

type ClosedTrade = {
    id: number;
    underlying: string;
    execution_ticker: string;
    signal_type: "LONG" | "SHORT";
    leverage: string;
    amount: number;
    shares: number;
    entry_price: number;
    exit_price: number;
    entered_at: string;
    exited_at: string;
    realized_pnl: number;
    realized_pnl_pct: number;
    market_session: string;
    conviction_level: "HIGH" | "MEDIUM" | "LOW" | null;
    trading_type: "POSITION" | "SWING" | "VOLATILE_EVENT" | "SCALP" | null;
    holding_period_hours: number | null;
    close_reason: string | null;
};

type EquityPoint = {
    at: string;
    cumulative_pnl: number;
    trade_pnl: number;
    trade_pnl_pct: number;
    ticker: string;
    underlying: string;
};

type TradingData = {
    market: MarketStatus;
    paper_trade_amount: number;
    summary: Summary;
    open_positions: OpenPosition[];
    closed_trades: ClosedTrade[];
    equity_curve: EquityPoint[];
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function pnlColor(val: number) {
    if (val > 0) return "text-emerald-400";
    if (val < 0) return "text-red-400";
    return "text-slate-400";
}

function pnlBg(val: number) {
    if (val > 0) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (val < 0) return "bg-red-500/10 text-red-400 border-red-500/20";
    return "bg-slate-700/30 text-slate-400 border-slate-600/20";
}

function fmt(val: number, decimals = 2) {
    return (val >= 0 ? "+" : "") + val.toFixed(decimals);
}

function fmtDollar(val: number) {
    return (val >= 0 ? "+$" : "-$") + Math.abs(val).toFixed(2);
}

function fmtDate(iso: string | null) {
    if (!iso) return "â€”";
    return new Date(iso).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
}

function SessionBadge({ session }: { session: string }) {
    const map: Record<string, string> = {
        open: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
        "pre-market": "bg-amber-500/10 text-amber-300 border-amber-500/20",
        "after-hours": "bg-blue-500/10 text-blue-300 border-blue-500/20",
        closed: "bg-slate-700/30 text-slate-400 border-slate-600/20",
    };
    const cls = map[session] || map.closed;
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium border ${cls}`}>
            {session}
        </span>
    );
}

function DirectionBadge({ signal }: { signal: string }) {
    if (signal === "LONG") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                <TrendingUp size={10} /> LONG
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-300 border border-red-500/20">
            <TrendingDown size={10} /> SHORT
        </span>
    );
}

function ConvictionBadge({ conviction, tradingType }: { conviction: string | null; tradingType: string | null }) {
    const label = tradingType ?? conviction ?? "—";
    const colors: Record<string, string> = {
        POSITION:      "bg-purple-500/10 text-purple-300 border-purple-500/20",
        SWING:         "bg-blue-500/10 text-blue-300 border-blue-500/20",
        VOLATILE_EVENT:"bg-amber-500/10 text-amber-300 border-amber-500/20",
        SCALP:         "bg-slate-500/10 text-slate-300 border-slate-500/20",
    };
    const cls = colors[tradingType ?? ""] ?? "bg-slate-500/10 text-slate-400 border-slate-500/20";
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold border ${cls}`}>
            {label}
        </span>
    );
}

function WindowBadge({ active, remaining }: { active: boolean; remaining: number | null }) {
    if (!active || remaining == null) return <span className="text-slate-600 text-[10px]">—</span>;
    const hrs = Math.floor(remaining / 60);
    const mins = remaining % 60;
    const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    return (
        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            🔒 {label}
        </span>
    );
}

function MarketBadge({ market }: { market: MarketStatus }) {
    const map: Record<string, string> = {
        open: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
        "pre-market": "bg-amber-500/10 text-amber-300 border-amber-500/20",
        "after-hours": "bg-blue-500/10 text-blue-300 border-blue-500/20",
        closed: "bg-slate-700/30 text-slate-400 border-slate-600/20",
    };
    const cls = map[market.status] || map.closed;
    const dot = market.tradeable ? "bg-emerald-400" : "bg-slate-500";
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
            {market.label}
        </span>
    );
}

// â”€â”€â”€ Stat Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StatCard({ label, value, sub, color = "" }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className="rounded-xl border border-white/8 p-4" style={{ background: "rgba(30,41,59,0.7)" }}>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
            <p className={`text-2xl font-black mt-1 ${color || "text-white"}`}>{value}</p>
            {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
    );
}

// â”€â”€â”€ Equity Curve â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EquityCurve({ data }: { data: EquityPoint[] }) {
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                No closed trades yet
            </div>
        );
    }

    const chartData = [{ at: "start", cumulative_pnl: 0, ticker: "" }, ...data].map((d, i) => ({
        x: i,
        pnl: d.cumulative_pnl,
        label: d.at === "start" ? "Start" : fmtDate(d.at),
        ticker: "ticker" in d ? d.ticker : "",
    }));

    const minPnl = Math.min(0, ...data.map(d => d.cumulative_pnl));
    const maxPnl = Math.max(0, ...data.map(d => d.cumulative_pnl));

    return (
        <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="x" hide />
                <YAxis
                    domain={[minPnl - 1, maxPnl + 1]}
                    tickFormatter={(v) => `$${v >= 0 ? "+" : ""}${v.toFixed(0)}`}
                    tick={{ fill: "#64748b", fontSize: 10 }}
                    width={52}
                />
                <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
                    formatter={(value: number) => [fmtDollar(value), "Cumulative P&L"]}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke={data[data.length - 1]?.cumulative_pnl >= 0 ? "#34d399" : "#f87171"}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}

// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function TradingPage() {
    const [data, setData] = useState<TradingData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resetting, setResetting] = useState(false);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const paperTradingResponse = await fetch("/api/paper-trading", { cache: "no-store" });
            if (!paperTradingResponse.ok) throw new Error(`HTTP ${paperTradingResponse.status}`);
            setData(await paperTradingResponse.json());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleReset = async () => {
        if (!confirm("Reset all paper trading history? This cannot be undone.")) return;
        setResetting(true);
        try {
            const r = await fetch("/api/paper-trading", { method: "DELETE" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Reset failed");
        } finally {
            setResetting(false);
        }
    };

    const s = data?.summary;

    return (
        <div className="min-h-screen" style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}>
            {/* Header */}
            <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-blue-400">
                            Paper Trading
                        </h1>
                        <p className="text-slate-500 text-xs mt-0.5">
                            ${data?.paper_trade_amount?.toFixed(0) ?? "100"} per signal &middot; auto-executed whenever the market is tradable
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {data?.market && <MarketBadge market={data.market} />}
                        <button
                            type="button"
                            onClick={load}
                            disabled={loading}
                            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-slate-700/60 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                        <Link href="/" className="text-xs text-slate-400 hover:text-white border border-slate-700/60 rounded-lg px-2.5 py-1.5">
                            Dashboard
                        </Link>
                        <button
                            type="button"
                            onClick={handleReset}
                            disabled={resetting || loading}
                            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
                        >
                            <Trash2 size={12} />
                            Reset
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                {error && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                        {error}
                    </div>
                )}

                {loading && !data && (
                    <div className="flex items-center justify-center py-20 text-slate-500 text-sm">
                        <RefreshCw size={16} className="animate-spin mr-2" /> Loading...
                    </div>
                )}

                {data && (
                    <>
                        {/* Summary stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <StatCard
                                label="Net P&L"
                                value={fmtDollar(s!.total_pnl)}
                                sub={`${fmt(s!.total_pnl_pct)}% of deployed`}
                                color={pnlColor(s!.total_pnl)}
                            />
                            <StatCard
                                label="Realized"
                                value={fmtDollar(s!.realized_pnl)}
                                sub={`${s!.closed_trades} closed trades`}
                                color={pnlColor(s!.realized_pnl)}
                            />
                            <StatCard
                                label="Open P&L"
                                value={fmtDollar(s!.open_pnl)}
                                sub={`${s!.open_positions} open positions`}
                                color={pnlColor(s!.open_pnl)}
                            />
                            <StatCard
                                label="Win Rate"
                                value={`${s!.win_rate.toFixed(0)}%`}
                                sub={`${s!.win_count}W / ${s!.loss_count}L`}
                                color={s!.win_rate >= 50 ? "text-emerald-400" : "text-red-400"}
                            />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <StatCard label="Avg Win" value={fmtDollar(s!.avg_win)} color="text-emerald-400" />
                            <StatCard label="Avg Loss" value={fmtDollar(s!.avg_loss)} color="text-red-400" />
                            <StatCard label="Total Deployed" value={`$${s!.total_deployed.toFixed(0)}`} />
                            <StatCard label="Total Trades" value={String(s!.total_trades)} />
                        </div>

                        {/* Equity curve */}
                        <div className="rounded-xl border border-white/8 p-5" style={{ background: "rgba(30,41,59,0.7)" }}>
                            <div className="flex items-center gap-2 mb-4">
                                <BarChart2 size={14} className="text-slate-400" />
                                <p className="text-sm font-semibold text-white">Equity Curve</p>
                                <p className="text-[10px] text-slate-500 ml-auto">Cumulative realized P&L over closed trades</p>
                            </div>
                            <EquityCurve data={data.equity_curve} />
                        </div>

                        {/* Open positions */}
                        {data.open_positions.length > 0 && (
                            <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: "rgba(30,41,59,0.7)" }}>
                                <div className="px-5 py-4 border-b border-white/8 flex items-center gap-2">
                                    <Activity size={14} className="text-emerald-400" />
                                    <p className="text-sm font-semibold text-white">Open Positions</p>
                                    <span className="ml-auto text-[10px] text-slate-500">{data.open_positions.length} position{data.open_positions.length !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-slate-500">
                                                <th className="px-4 py-2.5 text-left">Ticker</th>
                                                <th className="px-4 py-2.5 text-left">Direction</th>
                                                <th className="px-4 py-2.5 text-left">Leverage</th>
                                                <th className="px-4 py-2.5 text-left">Type</th>
                                                <th className="px-4 py-2.5 text-left">Window</th>
                                                <th className="px-4 py-2.5 text-right">Entry</th>
                                                <th className="px-4 py-2.5 text-right">Current</th>
                                                <th className="px-4 py-2.5 text-right">P&L</th>
                                                <th className="px-4 py-2.5 text-left">Entered</th>
                                                <th className="px-4 py-2.5 text-left">Session</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.open_positions.map((pos) => (
                                                <tr key={pos.id} className="border-b border-white/4 hover:bg-white/4 transition-colors">
                                                    <td className="px-4 py-3 font-semibold text-white">
                                                        {pos.execution_ticker}
                                                        <span className="text-slate-500 font-normal ml-1 text-[10px]">({pos.underlying})</span>
                                                    </td>
                                                    <td className="px-4 py-3"><DirectionBadge signal={pos.signal_type} /></td>
                                                    <td className="px-4 py-3 text-slate-300">{pos.leverage}</td>
                                                    <td className="px-4 py-3"><ConvictionBadge conviction={pos.conviction_level} tradingType={pos.trading_type} /></td>
                                                    <td className="px-4 py-3"><WindowBadge active={pos.window_active} remaining={pos.window_remaining_minutes} /></td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-300">${pos.entry_price.toFixed(2)}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-200">${pos.current_price.toFixed(2)}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className={`inline-block rounded px-1.5 py-0.5 border text-[10px] font-semibold ${pnlBg(pos.unrealized_pnl)}`}>
                                                            {fmtDollar(pos.unrealized_pnl)} ({fmt(pos.unrealized_pnl_pct)}%)
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-400">{fmtDate(pos.entered_at)}</td>
                                                    <td className="px-4 py-3"><SessionBadge session={pos.market_session} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {data.open_positions.length === 0 && (
                            <div className="rounded-xl border border-white/8 px-5 py-6 flex items-center gap-3 text-slate-500 text-sm" style={{ background: "rgba(30,41,59,0.7)" }}>
                                <Minus size={16} /> No open positions
                            </div>
                        )}

                        {/* Closed trades */}
                        {data.closed_trades.length > 0 && (
                            <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: "rgba(30,41,59,0.7)" }}>
                                <div className="px-5 py-4 border-b border-white/8 flex items-center gap-2">
                                    <DollarSign size={14} className="text-slate-400" />
                                    <p className="text-sm font-semibold text-white">Closed Trades</p>
                                    <span className="ml-auto text-[10px] text-slate-500">{data.closed_trades.length} trades</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-slate-500">
                                                <th className="px-4 py-2.5 text-left">Ticker</th>
                                                <th className="px-4 py-2.5 text-left">Direction</th>
                                                <th className="px-4 py-2.5 text-left">Leverage</th>
                                                <th className="px-4 py-2.5 text-right">Entry</th>
                                                <th className="px-4 py-2.5 text-right">Exit</th>
                                                <th className="px-4 py-2.5 text-right">Realized P&L</th>
                                                <th className="px-4 py-2.5 text-left">Closed At</th>
                                                <th className="px-4 py-2.5 text-left">Session</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.closed_trades.map((trade) => (
                                                <tr key={trade.id} className="border-b border-white/4 hover:bg-white/4 transition-colors">
                                                    <td className="px-4 py-3 font-semibold text-white">
                                                        {trade.execution_ticker}
                                                        <span className="text-slate-500 font-normal ml-1 text-[10px]">({trade.underlying})</span>
                                                    </td>
                                                    <td className="px-4 py-3"><DirectionBadge signal={trade.signal_type} /></td>
                                                    <td className="px-4 py-3 text-slate-300">{trade.leverage}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-300">${trade.entry_price.toFixed(2)}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-slate-300">${trade.exit_price.toFixed(2)}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className={`inline-block rounded px-1.5 py-0.5 border text-[10px] font-semibold ${pnlBg(trade.realized_pnl)}`}>
                                                            {fmtDollar(trade.realized_pnl)} ({fmt(trade.realized_pnl_pct)}%)
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-400">{fmtDate(trade.exited_at)}</td>
                                                    <td className="px-4 py-3"><SessionBadge session={trade.market_session} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {data.closed_trades.length === 0 && (
                            <div className="rounded-xl border border-white/8 px-5 py-6 flex items-center gap-3 text-slate-500 text-sm" style={{ background: "rgba(30,41,59,0.7)" }}>
                                <Minus size={16} /> No closed trades yet &mdash; trades close when the signal changes or flips direction
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

