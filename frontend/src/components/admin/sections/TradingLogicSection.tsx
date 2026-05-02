"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type TradingLogicSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
};

export function TradingLogicSection({ config, setConfig }: TradingLogicSectionProps) {
    const ld = config.logic_defaults;

    return (
        <section id="trading-logic" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">Trading Logic</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Override the default trading thresholds. Leave blank to use the system defaults from <code className="text-slate-400">logic_config.json</code>.
                </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div>
                    <p className="text-sm font-semibold text-slate-200">Extended-hours trading</p>
                    <p className="mt-1 text-xs text-slate-500">
                        Pre-market runs from 4:00 AM to 9:30 AM ET. After-hours runs from 4:00 PM to 8:00 PM ET.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                        These sessions usually have fewer active participants, which can mean thinner liquidity, wider bid/ask spreads,
                        more price gaps, and faster moves on relatively small order flow.
                    </p>
                </div>
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={config.allow_extended_hours_trading}
                        onChange={(e) => setConfig((current) => ({ ...current, allow_extended_hours_trading: e.target.checked }))}
                    />
                    Allow pre-market and after-hours paper trading
                </label>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div>
                    <p className="text-sm font-semibold text-slate-200">Hold overnight</p>
                    <p className="mt-1 text-xs text-slate-500">
                        When enabled, a position whose conviction window expires while the market is closed will
                        not be automatically closed. The position survives until the next open-market run, at
                        which point the normal signal logic applies — it may get re-confirmed, given a new
                        window, or closed based on the latest recommendation.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                        When disabled (default), an expired window closes the position as soon as the next
                        analysis run fired, even overnight. This keeps the simulation conservative — you are
                        never holding a position with no active thesis — but it means a trade that would have
                        re-confirmed at the next open is closed first, then reopened, incurring unnecessary
                        slippage in the simulated P&L.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                        Good choice if: you are trading instruments that can gap significantly overnight (e.g.
                        leveraged ETFs after a macro event) and want the simulation to mirror a trader who
                        sets a hard stop at close. Disable if you want the simulation to carry positions
                        through the night the same way a swing trader would.
                    </p>
                </div>
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={config.hold_overnight}
                        onChange={(e) => setConfig((current) => ({ ...current, hold_overnight: e.target.checked }))}
                    />
                    Hold positions overnight when the conviction window expires during closed hours
                </label>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div>
                    <p className="text-sm font-semibold text-slate-200">Trail on window expiry</p>
                    <p className="mt-1 text-xs text-slate-500">
                        When enabled (default), a position whose conviction window expires is not immediately
                        closed. Instead, a trailing stop is activated at half the normal stop-loss distance from
                        the best price seen. The position then stays open until price reverses through the stop.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                        This lets winners run past the original window — if USO is up 2% and the conviction
                        window expires, the trailing stop locks in most of that gain rather than closing flat.
                        The stop tightens each run as price moves further in your favour.
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                        When disabled, window expiry closes the position immediately at the current price, the
                        same as a hard time-stop. Use this if you prefer strict time discipline over letting
                        momentum extend the hold.
                    </p>
                </div>
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={config.trail_on_window_expiry}
                        onChange={(e) => setConfig((current) => ({ ...current, trail_on_window_expiry: e.target.checked }))}
                    />
                    Activate trailing stop when conviction window expires instead of closing immediately
                </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <label className="block">
                    <span className="text-xs text-slate-400">Re-entry Cooldown (minutes)</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                        Block re-opening the same direction on a symbol for this many minutes after a close.
                        Prevents rapid flip-and-re-enter churn. 0 = no cooldown.
                        Default: {ld.reentry_cooldown_minutes} min
                    </p>
                    <input
                        type="number"
                        min={0} max={10080} step={15}
                        value={config.reentry_cooldown_minutes ?? ""}
                        placeholder={String(ld.reentry_cooldown_minutes)}
                        onChange={(e) => setConfig((c) => ({ ...c, reentry_cooldown_minutes: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>
                <label className="block">
                    <span className="text-xs text-slate-400">Minimum Same-Day Exit Edge (%)</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                        Minimum profit edge required before the system is allowed to close a same-day winner on a flip,
                        ticker/leverage change, or missing recommendation. Small winners below this stay open to avoid churn.
                        Loss-cutting is still allowed. Default: {ld.min_same_day_exit_edge_pct}%
                    </p>
                    <input
                        type="number"
                        min={0} max={25} step={0.1}
                        value={config.min_same_day_exit_edge_pct ?? ""}
                        placeholder={String(ld.min_same_day_exit_edge_pct)}
                        onChange={(e) => setConfig((c) => ({ ...c, min_same_day_exit_edge_pct: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <label className="block">
                    <span className="text-xs text-slate-400">Paper Trade Amount ($)</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">Dollar size of each simulated trade. Default: ${ld.paper_trade_amount}</p>
                    <input
                        type="number"
                        min={1} max={100000} step={1}
                        value={config.paper_trade_amount ?? ""}
                        placeholder={String(ld.paper_trade_amount)}
                        onChange={(e) => setConfig((c) => ({ ...c, paper_trade_amount: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>

                <label className="block">
                    <span className="text-xs text-slate-400">Entry Threshold (directional score)</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">Minimum directional score needed to open a trade (0.05–1.0). Default: {ld.entry_threshold}</p>
                    <input
                        type="number"
                        min={0.05} max={1.0} step={0.01}
                        value={config.entry_threshold ?? ""}
                        placeholder={String(ld.entry_threshold)}
                        onChange={(e) => setConfig((c) => ({ ...c, entry_threshold: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>

                <label className="block">
                    <span className="text-xs text-slate-400">Stop Loss (%)</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">Max loss before closing a position. Default: {ld.stop_loss_pct}%</p>
                    <input
                        type="number"
                        min={0.1} max={50} step={0.1}
                        value={config.stop_loss_pct ?? ""}
                        placeholder={String(ld.stop_loss_pct)}
                        onChange={(e) => setConfig((c) => ({ ...c, stop_loss_pct: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>

                <label className="block">
                    <span className="text-xs text-slate-400">Take Profit (%)</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">Target gain before closing a position. Default: {ld.take_profit_pct}%</p>
                    <input
                        type="number"
                        min={0.1} max={100} step={0.1}
                        value={config.take_profit_pct ?? ""}
                        placeholder={String(ld.take_profit_pct)}
                        onChange={(e) => setConfig((c) => ({ ...c, take_profit_pct: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>

                <label className="block">
                    <span className="text-xs text-slate-400">Materiality Gate — Min New Articles</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">How many new articles are needed to justify a thesis flip. Default: {ld.materiality_min_posts_delta}</p>
                    <input
                        type="number"
                        min={1} max={100} step={1}
                        value={config.materiality_min_posts_delta ?? ""}
                        placeholder={String(ld.materiality_min_posts_delta)}
                        onChange={(e) => setConfig((c) => ({ ...c, materiality_min_posts_delta: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>

                <label className="block">
                    <span className="text-xs text-slate-400">Materiality Gate — Min Sentiment Delta</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">Minimum change in sentiment score to justify a thesis flip (0.01–1.0). Default: {ld.materiality_min_sentiment_delta}</p>
                    <input
                        type="number"
                        min={0.01} max={1.0} step={0.01}
                        value={config.materiality_min_sentiment_delta ?? ""}
                        placeholder={String(ld.materiality_min_sentiment_delta)}
                        onChange={(e) => setConfig((c) => ({ ...c, materiality_min_sentiment_delta: e.target.value === "" ? null : Number(e.target.value) }))}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>
            </div>
        </section>
    );
}