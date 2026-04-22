import { NextRequest, NextResponse } from "next/server";

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
        const response = await fetch(`${API_URL}/api/v1/config`, {
            cache: "no-store",
            headers: backendHeaders(),
        });
        if (!response.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json({ error: "Failed to load config" }, { status: 503 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const response = await fetch(`${API_URL}/api/v1/config`, {
            method: "PUT",
            headers: backendHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json({ error: "Failed to save config" }, { status: 503 });
    }
}
