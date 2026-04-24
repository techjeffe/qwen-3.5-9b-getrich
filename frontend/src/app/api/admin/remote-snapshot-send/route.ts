import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function backendHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    if (ADMIN_API_TOKEN) {
        headers.set("X-Admin-Token", ADMIN_API_TOKEN);
    }
    return headers;
}

export async function POST() {
    try {
        const response = await fetch(`${API_URL}/api/v1/admin/remote-snapshot-send`, {
            method: "POST",
            headers: backendHeaders(),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json({ error: payload?.detail || payload?.error || "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(payload);
    } catch {
        return NextResponse.json({ error: "Failed to queue remote snapshot send" }, { status: 503 });
    }
}
