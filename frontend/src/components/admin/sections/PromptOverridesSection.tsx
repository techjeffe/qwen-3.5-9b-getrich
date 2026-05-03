"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type PromptOverridesSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    updatePromptOverride: (symbol: string, value: string) => void;
};

const BUILT_IN_SYMBOLS = new Set(["USO", "BITO", "QQQ", "SPY"]);

const SYMBOL_PLACEHOLDER: Record<string, string> = {
    USO: `Weight EIA Wednesday inventory reports heavily when they diverge from analyst expectations — crude stock builds/draws are a stronger signal than geopolitical headlines alone.

During OPEC+ meeting windows, treat any production cut or freeze news as DIRECT and high-conviction even if EIA data hasn't confirmed yet.`,
    IBIT: `Currently tracking BTC spot ETF inflows as the primary confirmation signal — three consecutive days of positive IBIT inflows after a BTC rally materially raises conviction for LONG.

Treat SEC regulatory headlines with caution unless the action is specifically directed at spot ETFs; futures-based regulation has historically had muted IBIT impact.`,
    QQQ: `During earnings season (Jan, Apr, Jul, Oct), Nvidia and Microsoft guidance are the single strongest leading indicators — weight them above macro rate commentary for QQQ direction.

When 10-year real yields (DFII10 on FRED) move more than 15 bps intraday, treat that as DIRECT QQQ impact even if no tech-specific news triggered it.`,
    SPY: `High-yield OAS spread (BAMLH0A0HYM2 on FRED) is the primary stress confirmation — if SPY is rallying while spreads are widening more than 30 bps, flag the signal as lower conviction.

Weight non-farm payrolls and CPI releases as near-certain DIRECT drivers; do not downgrade them to INDIRECT even if the text only discusses them in macro context without naming SPY.`,
};

function getPlaceholder(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (SYMBOL_PLACEHOLDER[upper]) return SYMBOL_PLACEHOLDER[upper];
    return `${upper} has no built-in specialist context — this field IS the model's guidance.

Example for an equity like NVDA:
Focus on data center revenue guidance and AI chip lead times from earnings calls. Treat mentions of "Blackwell", "H100", or "GB200" as directly relevant. Secondary: China export restriction news. Weight institutional analyst revisions above retail sentiment.

Example for a sector ETF like XLE:
Mirror USO sensitivity for oil/gas exposure but also weight natural gas spreads and utility sector rotation. Treat Fed rate decisions as INDIRECT unless there's an explicit capex/drilling financing angle.`;
}

export function PromptOverridesSection({ config, updatePromptOverride }: PromptOverridesSectionProps) {
    return (
        <section id="prompts" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-sm font-semibold text-slate-200">Prompt Overrides</h2>
                    <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
                        Appended to the stage-2 specialist prompt under <span className="font-mono text-slate-400">Additional admin guidance for {"{symbol}"}:</span> — injected per-symbol before the model reasons about signals. Use this to add temporary market context, prioritize data sources, or adjust what the model treats as DIRECT exposure.
                    </p>
                </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 space-y-1.5">
                <p className="text-xs font-medium text-slate-300">When to use this</p>
                <ul className="text-xs text-slate-500 space-y-1 leading-relaxed">
                    <li>• <span className="text-slate-400">Custom symbols</span> — no built-in context exists; this field is the model's only guidance on what drives the asset</li>
                    <li>• <span className="text-slate-400">Default symbols</span> — supplements the built-in specialist focus; useful for current-regime context or source prioritization</li>
                    <li>• <span className="text-slate-400">Earnings windows, macro events</span> — temporarily weight a specific catalyst higher without changing the base profile</li>
                </ul>
                <p className="text-xs text-slate-600 mt-2 pt-2 border-t border-slate-800">Leave blank to use the built-in specialist guidance unchanged. Overrides are saved as part of config and apply to every subsequent run until cleared.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {config.tracked_symbols.map((symbol) => {
                    const isCustom = !BUILT_IN_SYMBOLS.has(symbol.toUpperCase());
                    return (
                        <label key={symbol} className="block">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs font-mono text-slate-300">{symbol}</span>
                                {isCustom ? (
                                    <span className="rounded-full border border-amber-700/50 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-400">
                                        no built-in context — fill this in
                                    </span>
                                ) : (
                                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">
                                        supplements built-in guidance
                                    </span>
                                )}
                            </div>
                            <textarea
                                rows={6}
                                value={config.symbol_prompt_overrides[symbol] ?? ""}
                                onChange={(e) => updatePromptOverride(symbol, e.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 leading-relaxed outline-none focus:border-blue-400 placeholder:text-slate-600"
                                placeholder={getPlaceholder(symbol)}
                            />
                        </label>
                    );
                })}
            </div>
        </section>
    );
}
