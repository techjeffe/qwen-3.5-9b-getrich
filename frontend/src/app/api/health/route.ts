import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET() {
    try {
        const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
        const payload = await response.json();
        return NextResponse.json(payload, { status: response.status });
    } catch {
        return NextResponse.json(
            {
                status: "offline",
                version: "1.0.0",
                database_status: "unreachable",
                runtime: {
                    started_at: null,
                    uptime_seconds: 0,
                    request_count: 0,
                    avg_request_latency_ms: 0,
                },
                model: {
                    reachable: false,
                    active_model: "",
                    configured_model: "",
                    available_models: [],
                    resolution: "unreachable",
                },
                analysis: {
                    avg_runtime_ms: null,
                    recent_analysis_seconds: [],
                    last_request_id: null,
                    last_completed_at: null,
                    last_status: "unknown",
                    last_error: "Backend health endpoint unavailable",
                    recent_run_count: 0,
                    tracked_symbols: [],
                    auto_run_enabled: false,
                    seconds_until_next_auto_run: 0,
                },
                data_pulls: {
                    latest: null,
                    recent: [],
                },
            },
            { status: 503 }
        );
    }
}
