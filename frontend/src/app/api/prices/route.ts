import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
    try {
        const symbols = request.nextUrl.searchParams.get("symbols");
        const target = symbols
            ? `${API_URL}/api/v1/prices?symbols=${encodeURIComponent(symbols)}`
            : `${API_URL}/api/v1/prices`;
        const r = await fetch(target, { cache: "no-store" });
        if (!r.ok) return NextResponse.json({}, { status: r.status });
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({}, { status: 503 });
    }
}
