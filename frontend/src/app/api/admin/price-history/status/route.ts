import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export async function GET() {
    try {
        const headers = new Headers();
        if (ADMIN_API_TOKEN) headers.set("X-Admin-Token", ADMIN_API_TOKEN);

        const response = await fetch(`${API_URL}/api/v1/admin/price-history/status`, {
            headers,
            cache: "no-store",
        });
        if (!response.ok) {
            return NextResponse.json(await response.json(), { status: response.status });
        }
        return NextResponse.json(await response.json());
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Status fetch failed" }, { status: 500 });
    }
}
