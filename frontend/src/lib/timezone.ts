import { useCallback, useEffect, useState } from "react";

const TZ_KEY = "tz_preference";

export const BROWSER_TZ =
    typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "UTC";

export const COMMON_TIMEZONES: { label: string; value: string }[] = [
    { label: `Auto-detect (${BROWSER_TZ})`, value: "" },
    { label: "UTC", value: "UTC" },
    { label: "Eastern – New York", value: "America/New_York" },
    { label: "Central – Chicago", value: "America/Chicago" },
    { label: "Mountain – Denver", value: "America/Denver" },
    { label: "Pacific – Los Angeles", value: "America/Los_Angeles" },
    { label: "Alaska", value: "America/Anchorage" },
    { label: "Hawaii", value: "Pacific/Honolulu" },
    { label: "London", value: "Europe/London" },
    { label: "Paris / Berlin", value: "Europe/Paris" },
    { label: "Moscow", value: "Europe/Moscow" },
    { label: "Dubai", value: "Asia/Dubai" },
    { label: "Mumbai", value: "Asia/Kolkata" },
    { label: "Singapore / Hong Kong", value: "Asia/Singapore" },
    { label: "Tokyo", value: "Asia/Tokyo" },
    { label: "Sydney", value: "Australia/Sydney" },
];

function resolvedTz(tz: string | null | undefined): string {
    return tz || BROWSER_TZ;
}

function normalizeIso(iso: string): string {
    const text = iso.trim();
    if (!text) return text;
    const hasTimezone = /[zZ]$|[+\-]\d{2}:\d{2}$/.test(text);
    return hasTimezone ? text : `${text}Z`;
}

export function getStoredTz(): string {
    if (typeof window === "undefined") return BROWSER_TZ;
    return resolvedTz(localStorage.getItem(TZ_KEY));
}

export function formatTs(
    iso: string | null | undefined,
    timeZone: string,
    opts?: Intl.DateTimeFormatOptions
): string {
    if (!iso) return "—";
    try {
        return new Date(normalizeIso(iso)).toLocaleString(undefined, {
            timeZone: resolvedTz(timeZone),
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            ...opts,
        });
    } catch {
        return new Date(normalizeIso(iso)).toLocaleString();
    }
}

export function formatTime(
    iso: string | null | undefined,
    timeZone: string
): string {
    if (!iso) return "—";
    try {
        return new Date(normalizeIso(iso)).toLocaleTimeString(undefined, {
            timeZone: resolvedTz(timeZone),
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return new Date(normalizeIso(iso)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
}

export function useTimezone() {
    const [timeZone, setTimeZoneState] = useState<string>(BROWSER_TZ);

    useEffect(() => {
        setTimeZoneState(getStoredTz());
    }, []);

    const setTimeZone = useCallback((tz: string) => {
        const resolved = resolvedTz(tz);
        if (typeof window !== "undefined") localStorage.setItem(TZ_KEY, resolved);
        setTimeZoneState(resolved);
    }, []);

    const storedRaw = typeof window !== "undefined" ? (localStorage.getItem(TZ_KEY) ?? "") : "";

    return { timeZone, storedRaw, setTimeZone };
}
