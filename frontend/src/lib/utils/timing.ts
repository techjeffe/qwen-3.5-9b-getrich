// ─── Timing & Utility Functions ───────────────────────────────────────────────

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

const MIN_TIMING_SAMPLE_SECONDS = 5;
const MAX_TIMING_SAMPLE_SECONDS = 1800;
const DEFAULT_MAX_TIMING_SAMPLES = 12;

export function sanitizeTimingSamples(samples: unknown, maxSamples = DEFAULT_MAX_TIMING_SAMPLES): number[] {
    if (!Array.isArray(samples)) return [];
    return samples
        .map((value) => Number(value))
        .filter((value) =>
            Number.isFinite(value)
            && value >= MIN_TIMING_SAMPLE_SECONDS
            && value <= MAX_TIMING_SAMPLE_SECONDS
        )
        .map((value) => Math.round(value))
        .slice(-Math.max(1, maxSamples));
}

export function appendTimingSample(samples: unknown, nextSampleSeconds: number, maxSamples = DEFAULT_MAX_TIMING_SAMPLES): number[] {
    return sanitizeTimingSamples(
        [...sanitizeTimingSamples(samples, maxSamples), nextSampleSeconds],
        maxSamples,
    );
}

export function mergeTimingSamples(
    primarySamples: unknown,
    secondarySamples: unknown,
    maxSamples = DEFAULT_MAX_TIMING_SAMPLES,
): number[] {
    const primary = sanitizeTimingSamples(primarySamples, maxSamples);
    const secondary = sanitizeTimingSamples(secondarySamples, maxSamples);
    return sanitizeTimingSamples([...secondary, ...primary], maxSamples);
}

export function percentile(sorted: number[], p: number) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function estimateRunTiming(samples: number[], fallbackSeconds: number) {
    const cleaned = sanitizeTimingSamples(samples, 8)
        .sort((a, b) => a - b);

    if (cleaned.length < 2) {
        const fallback = Math.max(15, Math.round(fallbackSeconds || 82));
        return {
            expectedSeconds: fallback,
            pacingSeconds: fallback,
            reliable: false,
        };
    }

    const trimmed = cleaned.length >= 5 ? cleaned.slice(1, -1) : cleaned;
    const mean = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    const median = percentile(cleaned, 0.5);
    const p75 = percentile(cleaned, 0.75);
    const variance = trimmed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / trimmed.length;
    const stdDev = Math.sqrt(variance);
    const expectedSeconds = Math.max(15, Math.round((mean + median) / 2));
    const pacingSeconds = Math.max(expectedSeconds, Math.round(Math.max(p75, expectedSeconds + stdDev * 0.35)));

    return {
        expectedSeconds,
        pacingSeconds,
        reliable: true,
    };
}

export function formatSignedScore(value?: number | null, digits = 2) {
    const numeric = Number(value ?? 0);
    return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}`;
}

export function livePnl(action: "BUY" | "SELL", entryPrice: number, currentPrice: number): number {
    const move = (currentPrice - entryPrice) / entryPrice * 100;
    return action === "SELL" ? -move : move;
}

export function paperPnlUsd(pct: number, notionalUsd = 100) {
    return notionalUsd * (pct / 100);
}

export function formatSignedUsd(value: number) {
    return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}
