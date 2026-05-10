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

        // Forward to backend API
        const response = await fetch(`${getBackendApiUrl()}/api/v1/analyze`, {
            method: "POST",
            headers: backendHeaders({
                "Content-Type": "application/json",
            }),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Backend API error" },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || "Failed to analyze market" },
            { status: 500 }
        );
    }
}
