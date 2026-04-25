import { NextRequest, NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

export async function GET(request: NextRequest) {
    try {
        const symbols = request.nextUrl.searchParams.get("symbols");
        const apiUrl = getBackendApiUrl();
        const target = symbols
            ? `${apiUrl}/api/v1/prices?symbols=${encodeURIComponent(symbols)}`
            : `${apiUrl}/api/v1/prices`;
        const r = await fetch(target, { cache: "no-store" });
        if (!r.ok) return NextResponse.json({}, { status: r.status });
        return NextResponse.json(await r.json());
    } catch {
        return NextResponse.json({}, { status: 503 });
    }
}
