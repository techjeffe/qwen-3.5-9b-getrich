import { NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ requestId: string }> }
) {
    try {
        const { requestId } = await params;
        const response = await fetch(`${getBackendApiUrl()}/api/v1/analysis-snapshots/${encodeURIComponent(requestId)}`, {
            cache: "no-store",
        });
        if (!response.ok) {
            return NextResponse.json(await response.json(), { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || "Failed to load analysis snapshot detail" },
            { status: 500 }
        );
    }
}
