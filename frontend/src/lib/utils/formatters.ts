// ─── Formatting & Display Utilities ─────────────────────────────────────────

import { AnalysisResult, AnalysisSnapshotItem, FeedItem, SentimentEntry } from "@/lib/types/analysis";

export function formatSnapshotLabel(snapshot: AnalysisSnapshotItem, timeZone: string) {
    const timestamp = snapshot.timestamp ? (typeof snapshot.timestamp === "string" ? formatTs(snapshot.timestamp, timeZone) : "Unknown time") : "Unknown time";
    const ext = snapshot.extraction_model?.trim();
    const rsn = snapshot.reasoning_model?.trim();
    let modelLabel: string;
    if (ext && rsn && ext !== rsn) {
        modelLabel = `${ext} / ${rsn}`;
    } else {
        modelLabel = ext || rsn || snapshot.model_name || "unknown model";
    }
    return `${timestamp} · ${snapshot.request_id} · ${modelLabel}`;
}

export function compactReasoning(reasoning?: string | null) {
    const text = (reasoning || "").replace(/\s+/g, " ").trim();
    if (!text) return "No saved reasoning.";
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
    return firstSentence.length > 220 ? `${firstSentence.slice(0, 217)}...` : firstSentence;
}

export function formatTs(timestamp: string | number | Date, timeZone: string): string {
    try {
        const date = typeof timestamp === "string" ? new Date(timestamp) :
            typeof timestamp === "number" ? new Date(timestamp * 1000) :
                timestamp;
        if (isNaN(date.getTime())) return "Unknown time";
        return date.toLocaleString("en-US", {
            timeZone: timeZone || undefined,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });
    } catch {
        return "Unknown time";
    }
}

export function formatTime(timestamp: string | number | Date, timeZone: string): string {
    try {
        const date = typeof timestamp === "string" ? new Date(timestamp) :
            typeof timestamp === "number" ? new Date(timestamp * 1000) :
                timestamp;
        if (isNaN(date.getTime())) return "";
        return date.toLocaleString("en-US", {
            timeZone: timeZone || undefined,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });
    } catch {
        return "";
    }
}

export function inferArticleSymbol(item: FeedItem & { kind: "article" }, sentimentScores?: Record<string, SentimentEntry>): string | null {
    const sourcePrefix = String(item.source || "").split("·")[0].trim().toUpperCase();
    if (sourcePrefix && sentimentScores?.[sourcePrefix]) {
        return sourcePrefix;
    }

    const normalizedKeywords = new Set(item.keywords.map((keyword) => keyword.trim().toUpperCase()).filter(Boolean));
    const matchingSymbols = Object.keys(sentimentScores || {}).filter((symbol) => normalizedKeywords.has(symbol.toUpperCase()));
    if (matchingSymbols.length === 1) {
        return matchingSymbols[0];
    }
    return null;
}

export function getArticleAssessment(item: FeedItem & { kind: "article" }, result: any) {
    const symbol = inferArticleSymbol(item, result?.sentiment_scores);
    if (!symbol) return null;

    const sentiment = result?.sentiment_scores?.[symbol];
    if (!sentiment) return null;

    const recommendation = (result?.trading_signal?.recommendations || []).find(
        (rec: any) => rec?.underlying_symbol === symbol
    );

    return {
        symbol,
        signalType: recommendation?.thesis || result?.trading_signal?.signal_type || "HOLD",
        confidence: typeof sentiment.confidence === "number"
            ? Math.round(sentiment.confidence * 100)
            : (result?.trading_signal ? Math.round(result.trading_signal.confidence_score * 100) : 0),
        reasoning: String(sentiment.reasoning || "").trim(),
    };
}

export function signalColor(signal: string | undefined) {
    if (signal === "LONG") return "text-emerald-400";
    if (signal === "SHORT") return "text-red-400";
    return "text-slate-400";
}

export function signalBadge(signal: string | undefined) {
    if (signal === "LONG") return "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
    if (signal === "SHORT") return "bg-red-500/10 border-red-500/30 text-red-300";
    return "bg-slate-800/60 border-slate-700 text-slate-400";
}