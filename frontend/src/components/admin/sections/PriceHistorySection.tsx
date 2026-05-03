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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-slate-300">Price History</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Daily OHLCV coverage for tracked symbols. Helps the strategy compute indicators and verify symbol readiness before trading.
                    </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                    {priceHistoryStatus?.all_ready ? "All symbols ready" : "Partial symbol coverage"}
                </div>
            </div>

            {priceHistoryStatus ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Symbols</p>
                            <p className="mt-2 text-lg font-semibold text-slate-100">{Object.keys(priceHistoryStatus.symbols).length}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Total rows</p>
                            <p className="mt-2 text-lg font-semibold text-slate-100">{priceHistoryStatus.total_rows.toLocaleString()}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                            <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Status</p>
                            <p className={`mt-2 text-lg font-semibold ${priceHistoryStatus.all_ready ? "text-emerald-300" : "text-amber-300"}`}>
                                {priceHistoryStatus.all_ready ? "Ready" : "Partial"}
                            </p>
                        </div>
                    </div>

                    <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-950/70">
                        <table className="min-w-full text-left text-xs text-slate-300">
                            <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-500">
                                <tr>
                                    <th className="px-4 py-3">Symbol</th>
                                    <th className="px-4 py-3">Rows</th>
                                    <th className="px-4 py-3">Earliest</th>
                                    <th className="px-4 py-3">Latest</th>
                                    <th className="px-4 py-3">Ready</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(priceHistoryStatus.symbols).map(([sym, info]) => (
                                    <tr key={sym} className="border-b border-slate-800 last:border-b-0">
                                        <td className="px-4 py-3 font-mono text-slate-100">{sym}</td>
                                        <td className="px-4 py-3 text-slate-300">{info.rows.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-slate-400">{info.earliest_date ?? "—"}</td>
                                        <td className="px-4 py-3 text-slate-400">{info.latest_date ?? "—"}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${info.ready ? "bg-emerald-600/15 text-emerald-300" : "bg-amber-600/15 text-amber-300"}`}>
                                                {info.ready ? "Ready" : "Pending"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : (
                <p className="text-xs text-slate-500 italic">Loading status…</p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                Fetches symbol history in batches with rate-limit spacing. If interrupted, existing data remains and the next pull resumes remaining symbols.
            </p>
        </section>
    );
}