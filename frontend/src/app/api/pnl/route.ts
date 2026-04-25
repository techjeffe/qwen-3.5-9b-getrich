import { NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

export async function GET() {
    try {
        const r = await fetch(`${getBackendApiUrl()}/api/v1/pnl`, { cache: "no-store" });
        if (!r.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: r.status });
        }
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({ error: "Failed to load P&L summary" }, { status: 503 });
    }
}
