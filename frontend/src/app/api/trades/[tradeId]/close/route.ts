import { NextRequest, NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ tradeId: string }> }
) {
    try {
        const { tradeId } = await context.params;
        const body = await request.json();
        const response = await fetch(`${getBackendApiUrl()}/api/v1/trades/${tradeId}/close`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(ADMIN_API_TOKEN ? { "X-Admin-Token": ADMIN_API_TOKEN } : {}),
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            return NextResponse.json({ error: "Backend API error" }, { status: response.status });
        }

        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Failed to record trade close" }, { status: 500 });
    }
}
