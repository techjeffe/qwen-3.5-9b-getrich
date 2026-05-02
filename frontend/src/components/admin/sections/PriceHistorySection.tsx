"use client";

type PriceHistorySectionProps = {
    isAdvancedMode: boolean;
    isPulling: boolean;
    pullStatus: { ok: boolean; message: string } | null;
    priceHistoryStatus: {
        symbols: Record<string, { rows: number; earliest_date: string | null; latest_date: string | null; ready: boolean }>;
        total_rows: number;
        all_ready: boolean;
    } | null;
    handlePullPriceHistory: () => void;
};

export function PriceHistorySection({
    isAdvancedMode, isPulling, pullStatus, priceHistoryStatus, handlePullPriceHistory,
}: PriceHistorySectionProps) {
    if (!isAdvancedMode) return null;

    return (
        <section id="price-history" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div>
                <h2 className="text-sm font-semibold text-slate-300">Price History</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Stores daily OHLCV data for all tracked symbols. Used to compute RSI, MACD, Bollinger Bands, ATR, OBV, and moving averages that are fed directly into each analysis. Data is never cleared by a database reset.
                </p>
            </div>

            {priceHistoryStatus && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Object.entries(priceHistoryStatus.symbols).map(([sym, info]) => (
                        <div key={sym} className={`rounded-lg border px-3 py-2 ${info.ready ? "border-emerald-800/60 bg-emerald-950/20" : "border-amber-800/60 bg-amber-950/20"}`}>
                            <p className="text-xs font-mono font-bold text-slate-200">{sym}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{info.rows.toLocaleString()} rows</p>
                            {info.latest_date && (
                                <p className="text-xs text-slate-500">through {info.latest_date}</p>
                            )}
                            {!info.ready && (
                                <p className="text-xs text-amber-400 mt-0.5">Needs pull</p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!priceHistoryStatus && (
                <p className="text-xs text-slate-500 italic">Loading status…</p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    type="button"
                    onClick={handlePullPriceHistory}
                    disabled={isPulling}
                    className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPulling ? "Pulling… (slow to avoid rate limits)" : "Pull Price History"}
                </button>
                {pullStatus && (
                    <span className={`text-xs ${pullStatus.ok ? "text-emerald-400" : "text-amber-400"}`}>
                        {pullStatus.message}
                    </span>
                )}
            </div>
            <p className="text-xs text-slate-600">
                Pulls ~14 months of daily data per symbol with a 3s delay between each to avoid rate limits.
                If interrupted, existing data is saved — re-run to fetch remaining symbols.
            </p>
        </section>
    );
}