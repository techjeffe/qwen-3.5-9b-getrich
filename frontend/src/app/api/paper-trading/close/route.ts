import { NextResponse } from "next/server";
import { getBackendApiUrl } from "@/lib/backend-api";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        if (!body.trade_id) {
            return NextResponse.json({ error: "Missing trade_id" }, { status: 400 });
        }
        const r = await fetch(`${getBackendApiUrl()}/api/v1/paper-trading/${body.trade_id}/close`, {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" }
        });
        if (!r.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: r.status });
        }
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({ error: "Failed to close paper trade" }, { status: 503 });
    }
}