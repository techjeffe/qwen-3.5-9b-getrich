import { NextRequest, NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function backendHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    if (ADMIN_API_TOKEN) {
        headers.set("X-Admin-Token", ADMIN_API_TOKEN);
    }
    return headers;
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const mode = searchParams.get("mode") || "";
        const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
        const response = await fetch(`${getBackendApiUrl()}/api/v1/alpaca/test-connection${qs}`, {
            method: "POST",
            headers: backendHeaders(),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json({ error: payload?.detail || payload?.error || "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(payload);
    } catch {
        return NextResponse.json({ error: "Failed to test Alpaca connection" }, { status: 503 });
    }
}
