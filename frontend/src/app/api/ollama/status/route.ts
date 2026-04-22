import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET() {
    try {
        const response = await fetch(`${API_URL}/api/v1/ollama/status`, { cache: "no-store" });
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
