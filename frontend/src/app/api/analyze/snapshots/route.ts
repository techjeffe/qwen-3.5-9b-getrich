import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const limit = url.searchParams.get("limit") || "10";
        const response = await fetch(`${API_URL}/api/v1/analysis-snapshots?limit=${encodeURIComponent(limit)}`, {
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
