import { NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function backendHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    if (ADMIN_API_TOKEN) {
        headers.set("X-Admin-Token", ADMIN_API_TOKEN);
    }
    return headers;
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const params = new URLSearchParams();
        const baseUrlParam = url.searchParams.get("base_url");
        const providerParam = url.searchParams.get("provider");
        if (baseUrlParam) params.set("base_url", baseUrlParam);
        if (providerParam) params.set("provider", providerParam);
        const qs = params.toString();
        const backendUrl = `${getBackendApiUrl()}/api/v1/admin/models${qs ? `?${qs}` : ""}`;
        const response = await fetch(backendUrl, {
            cache: "no-store",
            headers: backendHeaders(),
        });
        if (!response.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json({ error: "Failed to load models" }, { status: 503 });
    }
}