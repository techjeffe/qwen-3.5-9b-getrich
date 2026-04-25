import { NextRequest } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

// Edge runtime uses V8's native fetch — no undici body timeout. The Node
// runtime fetch (undici) kills SSE streams after 5 min of silence, which
// trips during long Stage 2 serialized Ollama work even with backend
// heartbeats. Edge runtime has no such timeout and is fine for a pure
// fetch+pipe proxy that uses no Node-only APIs.
export const runtime = "edge";
export async function POST(request: NextRequest) {
    const body = await request.json();
    const apiUrl = getBackendApiUrl();

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
