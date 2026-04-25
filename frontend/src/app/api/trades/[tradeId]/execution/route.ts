import { NextRequest, NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export async function DELETE(
    _request: NextRequest,
    context: { params: Promise<{ tradeId: string }> }
) {
    try {
        const { tradeId } = await context.params;
        const response = await fetch(`${getBackendApiUrl()}/api/v1/trades/${tradeId}/execution`, {
            method: "DELETE",
            headers: {
                ...(ADMIN_API_TOKEN ? { "X-Admin-Token": ADMIN_API_TOKEN } : {}),
            },
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: payload?.detail || "Backend API error" },
                { status: response.status }
            );
        }

        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Failed to remove execution" }, { status: 500 });
    }
}
