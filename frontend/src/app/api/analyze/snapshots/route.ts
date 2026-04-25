import { NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const limit = url.searchParams.get("limit") || "10";
        const response = await fetch(`${getBackendApiUrl()}/api/v1/analysis-snapshots?limit=${encodeURIComponent(limit)}`, {
            cache: "no-store",
        });
        if (!response.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json({ error: "Failed to load analysis snapshots" }, { status: 503 });
    }
}
