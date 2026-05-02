// ─── RSS Feed Utilities ───────────────────────────────────────────
// Normalizers and helpers for RSS feed configuration.

// ─── Symbol Input Normalizer ──────────────────────────────

export function normalizeSymbolInput(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10);
}

// ─── Feed URL Normalizer ──────────────────────────────────

export function normalizeFeedUrl(value: string): string {
    return value.trim();
}

// ─── Article Limit Normalizer ───────────────────────────

export function normalizeArticleLimit(value: string, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(50, Math.round(parsed)));
}