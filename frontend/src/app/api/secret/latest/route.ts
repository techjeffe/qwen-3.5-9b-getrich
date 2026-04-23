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

export async function GET() {
    try {
        const response = await fetch(`${API_URL}/api/v1/analysis-debug/latest`, {
            cache: "no-store",
            headers: backendHeaders(),
        });
        if (!response.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json({ error: "Failed to load latest debug run" }, { status: 503 });
    }
}
