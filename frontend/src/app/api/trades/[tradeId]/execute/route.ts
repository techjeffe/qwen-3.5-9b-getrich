import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ tradeId: string }> }
) {
    try {
        const { tradeId } = await context.params;
        const body = await request.json();
        const response = await fetch(`${API_URL}/api/v1/trades/${tradeId}/execute`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(ADMIN_API_TOKEN ? { "X-Admin-Token": ADMIN_API_TOKEN } : {}),
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Backend API error" },
                { status: response.status }
            );
        }

        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || "Failed to record trade execution" },
            { status: 500 }
        );
    }
}
