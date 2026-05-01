// ─── Comparison Utilities ───────────────────────────────────────────────────

import {
    AnalysisResult,
    Recommendation,
    SentimentEntry,
} from "@/lib/types/analysis";
import { compactReasoning } from "@/lib/utils/formatters";

// Stage comparison order
export const STAGE_COMPARE_ORDER: Array<{ key: string; label: string }> = [
    { key: "ingest", label: "Ingest" },
    { key: "stage1", label: "Stage 1" },
    { key: "stage2", label: "Stage 2" },
    { key: "red_team", label: "Red Team" },
];

export function buildChangeDrivers(
    underlying: string,
    baselineRec: Recommendation | undefined,
    comparisonRec: Recommendation | undefined,
    baselineSentiment: SentimentEntry | undefined,
    comparisonSentiment: SentimentEntry | undefined,
) {
    const drivers: string[] = [];
    const policyBefore = baselineSentiment?.policy_change;
    const policyAfter = comparisonSentiment?.policy_change;
    const blusterBefore = baselineSentiment?.market_bluster;
    const blusterAfter = comparisonSentiment?.market_bluster;
    const confidenceBefore = baselineSentiment?.confidence;
    const confidenceAfter = comparisonSentiment?.confidence;

    if (baselineRec && comparisonRec) {
        if (baselineRec.action !== comparisonRec.action) {
            drivers.push(`Trade direction flipped from ${baselineRec.action} to ${comparisonRec.action}.`);
        } else if (baselineRec.symbol !== comparisonRec.symbol) {
            drivers.push(`Execution proxy changed from ${baselineRec.symbol} to ${comparisonRec.symbol} while keeping the same ${underlying} thesis.`);
        }

        if (baselineRec.leverage !== comparisonRec.leverage) {
            drivers.push(`Leverage changed from ${baselineRec.leverage} to ${comparisonRec.leverage}.`);
        }
    } else if (baselineRec && !comparisonRec) {
        drivers.push(`The earlier run had a ${underlying} trade, but the later run removed it.`);
    } else if (!baselineRec && comparisonRec) {
        drivers.push(`The later run added a new ${underlying} trade that was not present before.`);
    }

    if (policyBefore !== undefined || policyAfter !== undefined || blusterBefore !== undefined || blusterAfter !== undefined) {
        drivers.push(
            `Policy ${formatSignedScore(policyBefore)} -> ${formatSignedScore(policyAfter)}; bluster ${formatSignedScore(blusterBefore)} -> ${formatSignedScore(blusterAfter)}.`
        );
    }

    if (
        baselineRec &&
        comparisonRec &&
        baselineRec.action === comparisonRec.action &&
        baselineRec.leverage !== comparisonRec.leverage &&
        confidenceBefore !== undefined &&
        confidenceAfter !== undefined
    ) {
        const crossedThreshold =
            (confidenceBefore >= 0.75 && confidenceAfter < 0.75) ||
            (confidenceBefore < 0.75 && confidenceAfter >= 0.75);
        if (crossedThreshold) {
            drivers.push(`Confidence moved ${confidenceBefore.toFixed(2)} -> ${confidenceAfter.toFixed(2)}, which likely crossed the 0.75 leverage threshold.`);
        } else {
            drivers.push(`Confidence moved ${confidenceBefore.toFixed(2)} -> ${confidenceAfter.toFixed(2)}.`);
        }
    } else if (confidenceBefore !== undefined || confidenceAfter !== undefined) {
        drivers.push(`Confidence ${Number(confidenceBefore ?? 0).toFixed(2)} -> ${Number(confidenceAfter ?? 0).toFixed(2)}.`);
    }

    return drivers;
}

function formatSignedScore(value?: number | null, digits = 2) {
    const numeric = Number(value ?? 0);
    return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}`;
}

// ─── StageMetricsComparison Component ──

export function StageMetricsComparison({
    baseline,
    comparison,
}: {
    baseline?: AnalysisResult | null;
    comparison?: AnalysisResult | null;
}) {
    const baselineMetrics = baseline?.stage_metrics || {};
    const comparisonMetrics = comparison?.stage_metrics || {};
    const hasMetrics = STAGE_COMPARE_ORDER.some(({ key }) => baselineMetrics[key] || comparisonMetrics[key]);
    if (!hasMetrics) return null;

    return (
        <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 overflow-hidden mb-4">
            <div className="grid grid-cols-3 gap-3 px-3 py-2 border-b border-slate-700/50 bg-slate-900/30 text-[10px] uppercase tracking-wider text-slate-500">
                <span>Stage</span>
                <span>Baseline</span>
                <span>Comparison</span>
            </div>
            {STAGE_COMPARE_ORDER.map(({ key, label }) => {
                const left = baselineMetrics[key];
                const right = comparisonMetrics[key];
                return (
                    <div key={key} className="grid grid-cols-3 gap-3 px-3 py-2.5 border-b border-slate-800/60 last:border-0">
                        <p className="text-xs font-semibold text-slate-200">{label}</p>
                        <div>
                            {left ? (
                                <>
                                    <p className="text-xs text-slate-200">{(left.duration_ms / 1000).toFixed(2)}s</p>
                                    <p className="text-[10px] text-slate-500 font-mono break-all">{left.model_name || left.status}</p>
                                </>
                            ) : (
                                <p className="text-[10px] text-slate-600 italic">—</p>
                            )}
                        </div>
                        <div>
                            {right ? (
                                <>
                                    <p className="text-xs text-slate-200">{(right.duration_ms / 1000).toFixed(2)}s</p>
                                    <p className="text-[10px] text-slate-500 font-mono break-all">{right.model_name || right.status}</p>
                                </>
                            ) : (
                                <p className="text-[10px] text-slate-600 italic">—</p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── ComparisonResultsCard Component ──

export function ComparisonResultsCard({
    title,
    baselineResult,
    comparisonResult,
    baselineLabel,
    comparisonLabel,
}: {
    title: string;
    baselineResult: AnalysisResult | null;
    comparisonResult: AnalysisResult | null;
    baselineLabel: string;
    comparisonLabel: string;
}) {
    if (!baselineResult || !comparisonResult) return null;

    const curRecs: Recommendation[] = baselineResult.trading_signal?.recommendations ?? [];
    const cmpRecs: Recommendation[] = comparisonResult.trading_signal?.recommendations ?? [];
    const curSentiment = baselineResult.sentiment_scores ?? {};
    const cmpSentiment = comparisonResult.sentiment_scores ?? {};
    const curMap: Record<string, Recommendation> = {};
    const cmpMap: Record<string, Recommendation> = {};
    for (const r of curRecs) curMap[r.underlying_symbol || r.symbol] = r;
    for (const r of cmpRecs) cmpMap[r.underlying_symbol || r.symbol] = r;
    const allUnderlying = Array.from(new Set([...Object.keys(curMap), ...Object.keys(cmpMap)]));
    const curSignal = baselineResult.trading_signal?.signal_type || "n/a";
    const cmpSignal = comparisonResult.trading_signal?.signal_type || "n/a";
    const signalMatch = curSignal === cmpSignal;
    const changedSymbols = allUnderlying.filter((underlying) => {
        const cur = curMap[underlying];
        const cmp = cmpMap[underlying];
        return !cur || !cmp || cur.symbol !== cmp.symbol || cur.action !== cmp.action || cur.leverage !== cmp.leverage;
    });

    return (
        <div className="rounded-2xl p-5"
            style={{ background: "rgba(30,41,59,0.75)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-[10px] text-slate-500 uppercase tracking-[0.24em] mb-2">{title}</p>
            <StageMetricsComparison baseline={baselineResult} comparison={comparisonResult} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline signal</p>
                    <p className={`text-sm font-bold mt-1 ${signalColor(curSignal)}`}>{curSignal}</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">{baselineLabel}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{(baselineResult.processing_time_ms / 1000).toFixed(2)}s</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison signal</p>
                    <p className={`text-sm font-bold mt-1 ${signalColor(cmpSignal)}`}>{cmpSignal}</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono break-all">{comparisonLabel}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{(comparisonResult.processing_time_ms / 1000).toFixed(2)}s</p>
                </div>
                <div className={`rounded-lg border p-3 col-span-2 ${signalMatch ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Agreement</p>
                    <p className={`text-sm font-semibold mt-1 ${signalMatch ? "text-emerald-400" : "text-amber-400"}`}>
                        {signalMatch ? "Runs agree on overall signal" : "Runs diverge — something materially changed"}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                        {changedSymbols.length > 0
                            ? `${changedSymbols.length} symbol${changedSymbols.length === 1 ? "" : "s"} changed recommendation.`
                            : "Ticker-level recommendations stayed the same."}
                    </p>
                </div>
            </div>
            {allUnderlying.length > 0 && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-3 py-3 border-b border-slate-700/50 bg-slate-900/20">
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline run</p>
                            <p className="text-xs text-slate-200 font-mono mt-1 break-all">{baselineLabel}</p>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison run</p>
                            <p className="text-xs text-slate-200 font-mono mt-1 break-all">{comparisonLabel}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2 border-b border-slate-700/50 bg-slate-900/40">
                        <span>Symbol</span>
                        <span>Baseline ticker</span>
                        <span>Comparison ticker</span>
                        <span>Match</span>
                    </div>
                    {allUnderlying.map((underlying) => {
                        const cur = curMap[underlying];
                        const cmp = cmpMap[underlying];
                        const same = !!(cur && cmp && cur.symbol === cmp.symbol && cur.action === cmp.action && cur.leverage === cmp.leverage);
                        const onlyInBaseline = !!(cur && !cmp);
                        const onlyInComparison = !!(!cur && cmp);
                        const sameDirection = !!(cur && cmp && cur.action === cmp.action && (cur.thesis ?? "") === (cmp.thesis ?? ""));
                        const leverageDrift = !same && sameDirection && !onlyInBaseline && !onlyInComparison;
                        const matchLabel = same ? "Same" : leverageDrift ? "Leverage diff" : "Different";
                        const matchCls = same ? "text-emerald-400" : leverageDrift ? "text-blue-400" : "text-amber-400";
                        const differenceHint = onlyInBaseline
                            ? "Only the baseline run recommended a trade for this symbol."
                            : onlyInComparison
                                ? "Only the comparison run recommended a trade for this symbol."
                                : same
                                    ? "Both runs chose the same execution ticker, action, and leverage."
                                    : leverageDrift
                                        ? "Both runs agree on direction but landed on different leverage tiers."
                                        : "The trade thesis changed enough to alter ticker, action, or direction.";
                        const curWhy = compactReasoning(curSentiment[underlying]?.reasoning);
                        const cmpWhy = compactReasoning(cmpSentiment[underlying]?.reasoning);
                        const drivers = buildChangeDrivers(
                            underlying,
                            cur,
                            cmp,
                            curSentiment[underlying],
                            cmpSentiment[underlying],
                        );
                        return (
                            <div key={underlying} className={`border-b border-slate-800/60 last:border-0 ${!same ? "bg-amber-500/5" : ""}`}>
                                <div className="grid grid-cols-4 px-3 py-2.5 items-center">
                                    <span className="text-xs font-bold text-slate-300 font-mono">{underlying}</span>
                                    <span className="text-xs font-mono text-slate-200">
                                        {cur ? <>{cur.action} <span className="font-bold">{cur.symbol}</span> <span className="text-slate-500">{cur.leverage}</span></> : <span className="text-slate-600 italic">—</span>}
                                    </span>
                                    <span className="text-xs font-mono text-slate-200">
                                        {cmp ? <>{cmp.action} <span className="font-bold">{cmp.symbol}</span> <span className="text-slate-500">{cmp.leverage}</span></> : <span className="text-slate-600 italic">—</span>}
                                    </span>
                                    <span className={`text-[10px] font-semibold uppercase ${matchCls}`}>{matchLabel}</span>
                                </div>
                                <div className="px-3 pb-3">
                                    <p className="text-[10px] text-slate-500 leading-relaxed">{differenceHint}</p>
                                    {!same && drivers.length > 0 && (
                                        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-amber-300">Why It Changed</p>
                                            <div className="mt-1.5 space-y-1">
                                                {drivers.map((driver) => (
                                                    <p key={`${underlying}-${driver}`} className="text-xs text-slate-200 leading-relaxed">
                                                        {driver}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-2">
                                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Baseline Why</p>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{curWhy}</p>
                                        </div>
                                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Comparison Why</p>
                                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{cmpWhy}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function signalColor(signal: string | undefined) {
    if (signal === "LONG") return "text-emerald-400";
    if (signal === "SHORT") return "text-red-400";
    return "text-slate-400";
}