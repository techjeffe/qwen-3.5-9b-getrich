import { NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

export async function GET() {
    try {
        const response = await fetch(`${getBackendApiUrl()}/api/v1/ollama/status`, { cache: "no-store" });
        if (!response.ok) {
            return NextResponse.json(
                { reachable: false, active_model: "", configured_model: "", available_models: [], resolution: "unreachable" },
                { status: response.status }
            );
        }
        return NextResponse.json(await response.json());
    } catch {
        return NextResponse.json(
            { reachable: false, active_model: "", configured_model: "", available_models: [], resolution: "unreachable" },
            { status: 503 }
        );
    }
}
