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
        const body = await request.json();
        const response = await fetch(`${getBackendApiUrl()}/api/v1/admin/openai-test-connection`, {
            method: "POST",
            headers: backendHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            return NextResponse.json(payload, { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json({ error: "Connection test failed" }, { status: 503 });
    }
}