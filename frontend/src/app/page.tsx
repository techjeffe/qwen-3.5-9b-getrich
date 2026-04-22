"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, WifiOff, ArrowRight, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SentimentTicker from "@/components/Dashboard/SentimentTicker";
import RollingWindowChart from "@/components/Dashboard/RollingWindowChart";

// ─── Types ──────────────────────────────────────────────────────────────────

type FeedItem =
    | { kind: "log"; message: string }
    | { kind: "article"; idx: number; source: string; title: string; description: string; keywords: string[] };

type PriceQuote = { price: number; change: number; change_pct: number; day_low: number; day_high: number };
type Prices = Record<string, PriceQuote>;

type Recommendation = { action: "BUY" | "SELL"; symbol: string; leverage: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const AUTORUN_SECS = 30 * 60;
const SYMBOLS = ["USO", "BITO", "QQQ", "SPY"];

const SIGNAL_RULES = [
    { border: "border-l-red-500",     bg: "bg-red-500/5",     label: "SHORT", labelColor: "text-red-400",    desc: "Bluster < −0.5 & Policy < 0.3" },
    { border: "border-l-emerald-500", bg: "bg-emerald-500/5", label: "LONG",  labelColor: "text-emerald-400", desc: "Policy Change > 0.7" },
    { border: "border-l-slate-600",   bg: "bg-slate-800/30",  label: "HOLD",  labelColor: "text-slate-400",   desc: "Default Condition" },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`rounded-2xl p-5 ${className}`}
            style={{ background: "rgba(30,41,59,0.75)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {children}
        </div>
    );
}

function PriceRow({ symbol, q }: { symbol: string; q: PriceQuote }) {
    const up = q.change_pct >= 0;
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-slate-700/40 last:border-0">
            <span className="text-xs font-mono font-bold text-slate-300">{symbol}</span>
            <div className="text-right">
                <span className="text-xs font-mono text-white">${q.price.toFixed(2)}</span>
                <span className={`ml-2 text-[10px] font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>
                    {up ? "+" : ""}{q.change_pct.toFixed(2)}%
                </span>
            </div>
        </div>
    );
}

function ArticleCard({ item, expanded, onToggle, result }: {
    item: FeedItem & { kind: "article" };
    expanded: boolean;
    onToggle: () => void;
    result: any;
}) {
    const signal = result?.trading_signal;
    const signalColor = signal?.signal_type === "LONG" ? "text-emerald-400" :
        signal?.signal_type === "SHORT" ? "text-red-400" : "text-slate-500";

    return (
        <div className="mb-2 rounded-xl border border-slate-700/60 overflow-hidden bg-slate-800/40 cursor-pointer"
            onClick={onToggle}>
            <div className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">{item.source}</span>
                    <p className={`text-sm text-slate-200 leading-snug mt-0.5 ${!expanded ? "line-clamp-2" : "whitespace-pre-wrap"}`}>
                        {item.title}
                    </p>
                </div>
                <div className="shrink-0 mt-0.5 text-slate-500">
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
            </div>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 pb-3 space-y-2 border-t border-slate-700/40 pt-2">
                            {item.description && item.description !== item.title && (
                                <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                            )}
                            {item.keywords.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {item.keywords.map((kw) => (
                                        <span key={kw} className="text-[10px] bg-blue-500/15 text-blue-300 px-2 py-0.5 rounded border border-blue-500/20">
                                            #{kw}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {result && (
                                <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-700/40">
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Model Assessment</p>
                                    <p className={`text-xs font-semibold ${signalColor}`}>
                                        Signal: {signal?.signal_type ?? "—"}  ·  Confidence: {signal ? Math.round(signal.confidence_score * 100) : 0}%
                                    </p>
                                    {result.aggregated_sentiment?.reasoning && (
                                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                            {result.aggregated_sentiment.reasoning.slice(0, 200)}…
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function RecommendationBadge({ rec }: { rec: Recommendation }) {
    const isBuy = rec.action === "BUY";
    return (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-bold text-sm ${
            isBuy
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/15 border-red-500/30 text-red-300"
        }`}>
            {isBuy ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{rec.action}</span>
            <span className="font-black">{rec.symbol}</span>
            <span className="font-mono text-xs opacity-70">{rec.leverage}</span>
        </div>
    );
}

function SignalHero({ signal }: { signal: any }) {
    if (!signal) return null;
    const isBuy = signal.signal_type === "LONG";
    const isShort = signal.signal_type === "SHORT";
    const color = isBuy ? "text-emerald-400" : isShort ? "text-red-400" : "text-slate-400";
    const border = isBuy ? "border-emerald-500/40" : isShort ? "border-red-500/40" : "border-slate-600/40";
    const bg = isBuy ? "bg-emerald-500/8" : isShort ? "bg-red-500/8" : "bg-slate-800/30";
    const pct = Math.round(signal.confidence_score * 100);

    return (
        <div className={`rounded-2xl border ${border} ${bg} p-5`}
            style={{ backdropFilter: "blur(12px)" }}>
            {/* Recommendations */}
            {signal.recommendations?.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                    {signal.recommendations.map((r: Recommendation, i: number) => (
                        <RecommendationBadge key={i} rec={r} />
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {isBuy ? <TrendingUp size={28} className="text-emerald-400" /> :
                     isShort ? <TrendingDown size={28} className="text-red-400" /> :
                     <Minus size={28} className="text-slate-400" />}
                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-widest">Signal</p>
                        <p className={`text-3xl font-black ${color}`}>
                            {isBuy ? "GO LONG" : isShort ? "GO SHORT" : "HOLD"}
                        </p>
                    </div>
                </div>
                <div className="text-right space-y-1">
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                        signal.urgency === "HIGH" ? "bg-red-500/10 border-red-500/20 text-red-400" :
                        signal.urgency === "MEDIUM" ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
                        "bg-slate-700 border-slate-600 text-slate-400"
                    }`}>{signal.urgency} URGENCY</span>
                </div>
            </div>

            <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Confidence</span>
                    <span className={`font-bold ${color}`}>{pct}%</span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className={`h-full rounded-full ${isBuy ? "bg-emerald-500" : isShort ? "bg-red-500" : "bg-slate-500"}`}
                    />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
                {[
                    { label: "Entry", val: signal.entry_symbol },
                    { label: "Stop Loss", val: `−${signal.stop_loss_pct}%`, cls: "text-red-400" },
                    { label: "Take Profit", val: `+${signal.take_profit_pct}%`, cls: "text-emerald-400" },
                ].map(({ label, val, cls }) => (
                    <div key={label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                        <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                        <p className={`text-sm font-bold ${cls ?? "text-white"}`}>{val}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
    const [result, setResult] = useState<any>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [expandedIdxs, setExpandedIdxs] = useState<Set<number>>(new Set());
    const [prices, setPrices] = useState<Prices | null>(null);
    const [countdown, setCountdown] = useState(AUTORUN_SECS);
    const feedBottomRef = useRef<HTMLDivElement>(null);
    const articleCounter = useRef(0);

    // Keep stable refs for the auto-run effect
    const isAnalyzingRef = useRef(false);
    useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);

    const handleAnalyze = useCallback(async () => {
        if (isAnalyzingRef.current) return;
        setIsAnalyzing(true);
        setError(null);
        setFeed([]);
        setExpandedIdxs(new Set());
        setResult(null);
        setCountdown(AUTORUN_SECS);
        articleCounter.current = 0;

        try {
            const response = await fetch("/api/analyze/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbols: SYMBOLS, max_posts: 50, include_backtest: true, lookback_days: 14 }),
            });
            if (!response.ok || !response.body) throw new Error(`Server error: ${response.statusText}`);

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
                        if (event.type === "log") {
                            setFeed((p) => [...p, { kind: "log", message: event.message }]);
                        } else if (event.type === "article") {
                            const idx = articleCounter.current++;
                            setFeed((p) => [...p, { kind: "article", idx, source: event.source, title: event.title, description: event.description ?? "", keywords: event.keywords ?? [] }]);
                        } else if (event.type === "result") {
                            setResult(event.data);
                        } else if (event.type === "error") {
                            setError(event.message);
                        }
                    } catch { /* malformed */ }
                }
            }
        } catch (err: any) {
            setError(err.message || "Failed to connect to backend");
        } finally {
            setIsAnalyzing(false);
        }
    }, []);

    // Auto-run countdown
    useEffect(() => {
        const tick = setInterval(() => {
            if (isAnalyzingRef.current) return;
            setCountdown((c) => {
                if (c <= 1) { handleAnalyze(); return AUTORUN_SECS; }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(tick);
    }, [handleAnalyze]);

    // Price polling
    const fetchPrices = useCallback(async () => {
        try {
            const r = await fetch("/api/prices");
            if (r.ok) setPrices(await r.json());
        } catch {}
    }, []);

    useEffect(() => {
        fetchPrices();
        const id = setInterval(fetchPrices, 60_000);
        return () => clearInterval(id);
    }, [fetchPrices]);

    // Auto-scroll feed
    useEffect(() => {
        feedBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [feed]);

    const toggleArticle = (idx: number) => {
        setExpandedIdxs((prev) => {
            const next = new Set(prev);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return next;
        });
    };

    const isOllamaError = error?.toLowerCase().includes("ollama");
    const articleItems = feed.filter((f): f is FeedItem & { kind: "article" } => f.kind === "article");
    const mm = Math.floor(countdown / 60);
    const ss = countdown % 60;

    return (
        <div className="min-h-screen" style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}>

            {/* ── Header ── */}
            <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                            Sentiment Trading Alpha
                        </h1>
                        <p className="text-slate-500 text-xs mt-0.5">USO · BITO · QQQ · SPY | Geopolitical Sentiment Pipeline</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {error && (
                            <span className="flex items-center gap-1.5 text-xs bg-red-500/10 text-red-400 px-3 py-1 rounded-full border border-red-500/20">
                                <WifiOff size={11} /> {isOllamaError ? "Ollama Unreachable" : "Error"}
                            </span>
                        )}
                        <div className="text-right">
                            <p className="text-[11px] text-slate-500">System Status</p>
                            <p className={`text-sm font-semibold ${isAnalyzing ? "text-yellow-400" : result ? "text-emerald-400" : "text-slate-400"}`}>
                                {isAnalyzing ? "Analyzing…" : result ? "Signal Ready" : "Idle"}
                            </p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* ── Left Sidebar ── */}
                    <div className="space-y-4">

                        {/* Engine Config */}
                        <GlassCard>
                            <h2 className="text-sm font-semibold text-slate-300 mb-4">Engine Config</h2>
                            <div className="space-y-2.5 text-sm mb-5">
                                {[
                                    { label: "Model", val: "Qwen 3.5 9b", cls: "text-blue-300 font-mono text-xs" },
                                    { label: "Feeds", val: "7 RSS Sources", cls: "font-mono text-xs" },
                                    { label: "Symbols", val: SYMBOLS.join(", "), cls: "font-mono text-xs" },
                                    { label: "Leverage", val: "3×", cls: "text-orange-400 font-mono text-xs font-bold" },
                                ].map(({ label, val, cls }) => (
                                    <div key={label} className="flex justify-between border-b border-slate-700/40 pb-2 last:border-0">
                                        <span className="text-slate-400">{label}</span>
                                        <span className={cls}>{val}</span>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleAnalyze} disabled={isAnalyzing}
                                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                                    isAnalyzing ? "bg-slate-700 cursor-not-allowed text-slate-400" : "bg-blue-600 hover:bg-blue-500 text-white"
                                }`}>
                                {isAnalyzing ? <><Activity size={14} className="animate-spin" /> Analyzing…</> :
                                 result ? <>Run Again <ArrowRight size={14} /></> :
                                 <>Analyze Market <ArrowRight size={14} /></>}
                            </button>
                            {/* Auto-run countdown */}
                            <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-slate-600">
                                <Clock size={11} />
                                <span>Auto-run in {mm}:{ss.toString().padStart(2, "0")}</span>
                            </div>
                        </GlassCard>

                        {/* Live Prices */}
                        <GlassCard>
                            <h2 className="text-sm font-semibold text-slate-300 mb-3">Market Prices</h2>
                            {prices ? (
                                <div>
                                    {Object.entries(prices).map(([sym, q]) => (
                                        <PriceRow key={sym} symbol={sym} q={q} />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-600 italic">Loading…</p>
                            )}
                        </GlassCard>

                        {/* Signal Logic */}
                        <GlassCard>
                            <h2 className="text-sm font-semibold text-slate-300 mb-3">Signal Logic</h2>
                            <div className="space-y-2">
                                {SIGNAL_RULES.map(({ border, bg, label, labelColor, desc }) => (
                                    <div key={label} className={`border-l-4 ${border} ${bg} p-2.5 rounded-r-lg`}>
                                        <p className={`text-xs font-bold uppercase ${labelColor}`}>{label}</p>
                                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">{desc}</p>
                                    </div>
                                ))}
                            </div>
                        </GlassCard>

                        {/* Run Stats */}
                        {result && (
                            <GlassCard>
                                <h2 className="text-sm font-semibold text-slate-300 mb-3">Run Stats</h2>
                                <div className="space-y-1.5 text-sm">
                                    {[
                                        { label: "Articles", val: result.posts_scraped },
                                        { label: "Symbols", val: result.symbols_analyzed?.join(", ") },
                                        { label: "Duration", val: `${(result.processing_time_ms / 1000).toFixed(1)}s` },
                                    ].map(({ label, val }) => (
                                        <div key={label} className="flex justify-between">
                                            <span className="text-slate-400 text-xs">{label}</span>
                                            <span className="font-mono text-xs">{val}</span>
                                        </div>
                                    ))}
                                </div>
                            </GlassCard>
                        )}
                    </div>

                    {/* ── Main Content ── */}
                    <div className="lg:col-span-2 space-y-5">

                        {/* Error Banner */}
                        <AnimatePresence>
                            {error && (
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                    className={`p-4 rounded-xl border flex items-start gap-3 ${isOllamaError
                                        ? "bg-orange-950/60 border-orange-700/50 text-orange-300"
                                        : "bg-red-950/60 border-red-700/50 text-red-300"}`}>
                                    <WifiOff size={16} className="mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-semibold text-sm">{isOllamaError ? "Ollama not reachable" : "Error"}</p>
                                        <p className="text-sm mt-0.5 opacity-80">{error}</p>
                                        {isOllamaError && (
                                            <code className="text-xs mt-2 block bg-black/40 px-3 py-1.5 rounded font-mono">
                                                ollama run qwen3.5:9b
                                            </code>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Signal Hero (results) */}
                        <AnimatePresence>
                            {result && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                                    <SignalHero signal={result.trading_signal} />
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                        <SentimentTicker data={result.sentiment_scores} />
                                        <RollingWindowChart backtestResults={result.backtest_results} lookbackDays={14} />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Idle state */}
                        {!result && !isAnalyzing && feed.length === 0 && !error && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <GlassCard className="text-center py-8">
                                    <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">Ready</p>
                                    <h2 className="text-2xl font-black mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                                        Geopolitical Sentiment → Trade Signal
                                    </h2>
                                    <p className="text-slate-500 text-sm max-w-md mx-auto">
                                        Fetches live headlines, runs Qwen 3.5 9b sentiment analysis,
                                        generates BUY/SELL signals for USO, BITO, QQQ, SPY — backtests on 6 months of data.
                                    </p>
                                    <p className="text-slate-600 text-xs mt-4">Auto-runs in {mm}:{ss.toString().padStart(2, "0")}</p>
                                </GlassCard>
                            </motion.div>
                        )}

                        {/* Article Feed */}
                        {feed.length > 0 && (
                            <GlassCard className="!p-0 overflow-hidden">
                                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/40">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-300">Live Feed</span>
                                        {articleItems.length > 0 && (
                                            <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/20">
                                                {articleItems.length} articles
                                            </span>
                                        )}
                                    </div>
                                    {isAnalyzing && (
                                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            Running
                                        </span>
                                    )}
                                </div>
                                <div className="max-h-[520px] overflow-y-auto p-4">
                                    {feed.map((item, i) => {
                                        if (item.kind === "article") {
                                            return (
                                                <ArticleCard
                                                    key={i}
                                                    item={item}
                                                    expanded={expandedIdxs.has(item.idx)}
                                                    onToggle={() => toggleArticle(item.idx)}
                                                    result={result}
                                                />
                                            );
                                        }
                                        return (
                                            <div key={i} className="flex items-start gap-2 py-0.5 text-xs text-slate-500 font-mono">
                                                <span className="text-slate-700 shrink-0">›</span>
                                                <span>{item.message}</span>
                                            </div>
                                        );
                                    })}
                                    {isAnalyzing && (
                                        <div className="flex items-center gap-2 text-slate-700 text-xs font-mono py-1">
                                            <span>›</span><span className="animate-pulse">▋</span>
                                        </div>
                                    )}
                                    <div ref={feedBottomRef} />
                                </div>
                            </GlassCard>
                        )}
                    </div>
                </div>
            </main>

            <footer className="mt-16 pb-8 text-center text-slate-700 text-xs">
                Educational use only · Not financial advice · Trading leveraged ETFs carries significant risk
            </footer>
        </div>
    );
}
