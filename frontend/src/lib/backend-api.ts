const DEFAULT_BACKEND_API_URL = "http://127.0.0.1:8000";

function normalizeLoopbackUrl(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname === "localhost") {
            parsed.hostname = "127.0.0.1";
        }
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return DEFAULT_BACKEND_API_URL;
    }
}

export function getBackendApiUrl(): string {
    const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
    return normalizeLoopbackUrl(configuredUrl || DEFAULT_BACKEND_API_URL);
}
