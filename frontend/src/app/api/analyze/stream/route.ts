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

    const encoder = new TextEncoder();
    const reader = backendResponse.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(
                encoder.encode(
                    `data: ${JSON.stringify({ type: "log", message: "Connected to backend stream..." })}\n\n`
                )
            );
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) controller.enqueue(value);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Stream interrupted";
                controller.enqueue(
                    encoder.encode(
                        `data: ${JSON.stringify({ type: "error", message })}\n\n`
                    )
                );
            } finally {
                reader.releaseLock();
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
