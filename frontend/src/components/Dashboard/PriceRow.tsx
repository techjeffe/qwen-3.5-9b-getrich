import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function PriceRow({ symbol, q }: { symbol: string; q: { price: number; change: number; change_pct: number; day_low: number; day_high: number; session?: string; as_of?: string; source?: string; is_stale?: boolean } }) {
    const pos = q.change_pct >= 0;
    const Icon = pos ? TrendingUp : TrendingDown;
    return (
        <div className="flex items-center justify-between py-1.5 px-1 border-b border-slate-800/30 last:border-0">
            <div>
                <span className="text-sm font-bold">{symbol}</span>
                <span className="text-[10px] text-slate-500 ml-2">
                    {q.is_stale && "(cached)"}
                    {q.session && ` · ${q.session}`}
                </span>
            </div>
            <div className="text-right">
                <div className="text-sm font-bold">
                    {q.price.toFixed(2)}
                </div>
                <div className="text-[10px] flex items-center gap-1 justify-end">
                    <Icon size={9} className={pos ? "text-emerald-400" : "text-red-400"} />
                    <span className={pos ? "text-emerald-400" : "text-red-400"}>
                        {q.change.toFixed(3)} ({pos ? "+" : ""}{q.change_pct.toFixed(2)}%)
                    </span>
                </div>
            </div>
        </div>
    );
}