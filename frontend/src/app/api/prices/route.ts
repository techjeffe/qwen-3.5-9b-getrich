import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET() {
    try {
        const r = await fetch(`${API_URL}/api/v1/prices`, { cache: "no-store" });
        if (!r.ok) return NextResponse.json({}, { status: r.status });
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({}, { status: 503 });
    }
}
