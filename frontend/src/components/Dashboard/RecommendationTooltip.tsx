import { useState } from "react";
import { Info, ArrowUp, ArrowDown } from "lucide-react";
import { Recommendation } from "@/lib/types/analysis";

export default function RecommendationTooltip({ recommendation }: { recommendation: Recommendation }) {
    const [show, setShow] = useState(false);
    const isBuy = recommendation.action === "BUY";
    const underlying = recommendation.underlying_symbol || recommendation.symbol;
    const isProxy = recommendation.symbol !== underlying;

    const lines = [
        `${recommendation.action} ${isProxy ? recommendation.symbol : underlying}`,
        isProxy ? `Proxy for ${underlying}` : null,
        `Leverage: ${recommendation.leverage}`,
        recommendation.thesis === "LONG"
            ? `Bullish view on ${underlying}`
            : recommendation.thesis === "SHORT"
                ? `Bearish view on ${underlying}`
                : null,
    ].filter(Boolean) as string[];

    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
        >
            <button
                type="button"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                    isBuy
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
            >
                {isBuy ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                {recommendation.action}
                <Info size={9} className="text-slate-500" />
            </button>
            {show && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50">
                    <div className="rounded-lg border border-slate-700 bg-slate-900/95 backdrop-blur p-3 w-64 shadow-xl">
                        {lines.map((line, i) => (
                            <p key={i} className="text-xs text-slate-300 leading-relaxed">
                                {line}
                            </p>
                        ))}
                    </div>
                    <div className="w-3 h-3 rotate-45 bg-slate-900/90 border-r border-b border-slate-700 mx-auto" />
                </div>
            )}
        </div>
    );
}