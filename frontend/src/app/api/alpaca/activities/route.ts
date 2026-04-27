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
        const activityType = searchParams.get("activity_type") || "";
        const limit = searchParams.get("limit") || "100";
        let url = `${getBackendApiUrl()}/api/v1/alpaca/activities?limit=${limit}`;
        if (activityType) url += `&activity_type=${encodeURIComponent(activityType)}`;
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
        return NextResponse.json({ error: "Failed to load account activities" }, { status: 503 });
    }
}
