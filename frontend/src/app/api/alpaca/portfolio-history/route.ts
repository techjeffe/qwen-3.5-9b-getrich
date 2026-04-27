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

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get("period") || "1M";
        const timeframe = searchParams.get("timeframe") || "1D";
        const extendedHours = searchParams.get("extended_hours") || "false";
        const url = `${getBackendApiUrl()}/api/v1/alpaca/portfolio-history?period=${period}&timeframe=${timeframe}&extended_hours=${extendedHours}`;
        const response = await fetch(url, {
            cache: "no-store",
            headers: backendHeaders(),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json({ error: payload?.detail || payload?.error || "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(payload);
    } catch {
        return NextResponse.json({ error: "Failed to load portfolio history" }, { status: 503 });
    }
}
