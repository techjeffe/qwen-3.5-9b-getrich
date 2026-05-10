import { NextRequest, NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function backendHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    if (ADMIN_API_TOKEN) {
        headers.set("X-Admin-Token", ADMIN_API_TOKEN);
    }
    return headers;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const requestId = String(body.request_id || "").trim();
        const modelName = String(body.model_name || "").trim();
        const extractionModel = String(body.extraction_model || "").trim();
        const reasoningModel = String(body.reasoning_model || "").trim();

        if (!requestId || (!modelName && !extractionModel)) {
            return NextResponse.json({ error: "request_id and model_name (or extraction_model) are required" }, { status: 400 });
        }

        const backendPayload: Record<string, string> = {};
        if (modelName) backendPayload.model_name = modelName;
        if (extractionModel) backendPayload.extraction_model = extractionModel;
        if (reasoningModel) backendPayload.reasoning_model = reasoningModel;

        const response = await fetch(`${getBackendApiUrl()}/api/v1/analysis-snapshots/${encodeURIComponent(requestId)}/rerun`, {
            method: "POST",
            headers: backendHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(backendPayload),
        });

        if (!response.ok) {
            return NextResponse.json(await response.json(), { status: response.status });
        }

        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || "Failed to rerun analysis snapshot" },
            { status: 500 }
        );
    }
}
