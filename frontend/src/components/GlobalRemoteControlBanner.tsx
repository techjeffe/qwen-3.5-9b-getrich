"use client";

import { useCallback, useEffect, useState } from "react";

type BannerPayload = {
    telegram_remote_control_banner_active?: boolean;
    telegram_remote_control_banner_message?: string;
};

const POLL_INTERVAL_MS = 30000;

export default function GlobalRemoteControlBanner() {
    const [message, setMessage] = useState("");
    const [active, setActive] = useState(false);
    const [isAcknowledging, setIsAcknowledging] = useState(false);

    const fetchBannerState = useCallback(async () => {
        try {
            const response = await fetch("/api/config", { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json() as BannerPayload;
            const nextActive = !!payload.telegram_remote_control_banner_active;
            const nextMessage = String(payload.telegram_remote_control_banner_message || "");
            setActive(nextActive && !!nextMessage.trim());
            setMessage(nextMessage);
        } catch {
            // best effort only
        }
    }, []);

    useEffect(() => {
        void fetchBannerState();
        const intervalId = window.setInterval(() => {
            void fetchBannerState();
        }, POLL_INTERVAL_MS);
        return () => window.clearInterval(intervalId);
    }, [fetchBannerState]);

    const acknowledge = useCallback(async () => {
        setIsAcknowledging(true);
        try {
            const response = await fetch("/api/admin/telegram-remote-control-banner/acknowledge", {
                method: "POST",
            });
            if (response.ok) {
                setActive(false);
                setMessage("");
            }
        } finally {
            setIsAcknowledging(false);
        }
    }, []);

    if (!active || !message.trim()) {
        return null;
    }

    return (
        <div className="sticky top-0 z-[100] border-b border-amber-700/60 bg-amber-400/15 backdrop-blur-sm">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 text-sm text-amber-100">
                <div className="flex-1">
                    <span className="font-semibold text-amber-200">Remote control update:</span>{" "}
                    <span>{message}</span>
                </div>
                <button
                    type="button"
                    onClick={() => void acknowledge()}
                    disabled={isAcknowledging}
                    className="shrink-0 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
                >
                    {isAcknowledging ? "Acknowledging..." : "Acknowledge"}
                </button>
            </div>
        </div>
    );
}
