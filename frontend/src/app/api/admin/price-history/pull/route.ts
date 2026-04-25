import { NextResponse } from "next/server";

import { getBackendApiUrl } from "@/lib/backend-api";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export async function POST() {
    try {
        const headers = new Headers({ "Content-Type": "application/json" });
        if (ADMIN_API_TOKEN) headers.set("X-Admin-Token", ADMIN_API_TOKEN);

        const response = await fetch(`${getBackendApiUrl()}/api/v1/admin/price-history/pull`, {
            method: "POST",
            headers,
        });
        if (!response.ok) {
            return NextResponse.json(await response.json(), { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Pull failed" }, { status: 500 });
    }
}
