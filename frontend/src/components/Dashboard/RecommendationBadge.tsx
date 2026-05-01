import { ArrowUp, ArrowDown, Minus } from "lucide-react";

export default function RecommendationBadge({ action }: { action: "BUY" | "SELL" }) {
    const isBuy = action === "BUY";
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
            isBuy
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
        }`}>
            {isBuy ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            {action}
        </span>
    );
}