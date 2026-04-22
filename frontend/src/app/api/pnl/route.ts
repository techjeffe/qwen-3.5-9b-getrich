import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET() {
    try {
        const r = await fetch(`${API_URL}/api/v1/pnl`, { cache: "no-store" });
        if (!r.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: r.status });
        }
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({ error: "Failed to load P&L summary" }, { status: 503 });
    }
}
