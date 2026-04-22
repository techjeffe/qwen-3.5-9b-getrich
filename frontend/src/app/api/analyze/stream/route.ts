import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
    const body = await request.json();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    const backendResponse = await fetch(`${apiUrl}/api/v1/analyze/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!backendResponse.ok || !backendResponse.body) {
        return new Response(
            `data: ${JSON.stringify({ type: "error", message: "Backend unreachable" })}\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
    }

    return new Response(backendResponse.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}
