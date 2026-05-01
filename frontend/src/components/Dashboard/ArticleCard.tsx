import { ChevronDown, ChevronUp } from "lucide-react";

export default function ArticleCard({
    item,
    expanded,
    onToggle,
    result,
}: {
    item: { idx: number; source: string; title: string; description: string; keywords: string[] };
    expanded: boolean;
    onToggle: () => void;
    result: any;
}) {
    const assessment = result
        ? (() => {
            const sourcePrefix = String(item.source).split("·")[0].trim().toUpperCase();
            if (!result.sentiment_scores?.[sourcePrefix]) return null;
            const sentiment = result.sentiment_scores[sourcePrefix];
            const rec = (result.trading_signal?.recommendations ?? []).find(
                (r: any) => r.underlying_symbol === item.keywords[0]
            );
            return { sentiment, rec, sourcePrefix };
        })()
        : null;

    return (
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-3 mb-2">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] bg-slate-800/60 px-2 py-0.5 rounded-md text-slate-400 font-mono">
                            {item.source}
                        </span>
                        {assessment && (
                            <span className="text-[10px] font-bold text-slate-500">
                                {assessment.sourcePrefix}
                            </span>
                        )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-200 mt-1.5 leading-snug">
                        {item.title}
                    </h3>
                </div>
                <button
                    type="button"
                    onClick={onToggle}
                    className="shrink-0 text-slate-600 hover:text-slate-400"
                >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            </div>
            {expanded && (
                <div className="mt-2 text-xs text-slate-400 leading-relaxed">
                    <p>{item.description}</p>
                    {item.keywords.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-slate-600">Keywords:</span>
                            {item.keywords.map((kw) => (
                                <span key={kw} className="text-[10px] bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/15">
                                    {kw}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}