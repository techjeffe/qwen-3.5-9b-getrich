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

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ symbol: string }> }
) {
    try {
        const { symbol } = await params;
        const { mode } = await req.json();

        const modeParam = mode ? `?mode=${mode}` : "";
        const r = await fetch(`${getBackendApiUrl()}/api/v1/alpaca/positions/${symbol.toUpperCase()}/close${modeParam}`, {
            method: "POST",
            cache: "no-store",
            headers: backendHeaders({ "Content-Type": "application/json" })
        });
        if (!r.ok) {
            const errorBody = await r.json().catch(() => ({ detail: r.statusText }));
            return NextResponse.json({ error: errorBody.detail || "Failed to close position" }, { status: r.status });
        }
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({ error: "Failed to close Alpaca position" }, { status: 503 });
    }
}
