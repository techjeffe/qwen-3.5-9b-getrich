"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type DepthOption = {
    key: AppConfig["rss_article_detail_mode"];
    label: string;
    tagline: string;
    pipeline: string;
};

type RiskOption = {
    key: string;
    label: string;
    tagline: string;
    description: string;
    maxLeverage: string;
    color: string;
};

type OverviewSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    isAdvancedMode: boolean;
    riskOptions: RiskOption[];
    depthOptions: DepthOption[];
};

const activeColorStyles: Record<string, string> = {
    blue: "border-blue-400 bg-blue-500/10 text-blue-100",
    teal: "border-teal-400 bg-teal-500/10 text-teal-100",
    amber: "border-amber-400 bg-amber-500/10 text-amber-100",
    rose: "border-rose-400 bg-rose-500/10 text-rose-100",
};

export function OverviewSection({ config, setConfig, isAdvancedMode, riskOptions, depthOptions }: OverviewSectionProps) {
    return (
        <section id="overview" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                <label className="block lg:hidden">
                    <span className="text-xs text-slate-400">Jump to section</span>
                    <select
                        defaultValue=""
                        onChange={(e) => {
                            const sectionId = e.target.value;
                            e.currentTarget.value = "";
                            if (sectionId) {
                                const el = document.getElementById(sectionId);
                                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                        }}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    >
                        <option value="">Choose a section…</option>
                        <option value="models">Models</option>
                        <option value="symbols">Symbols</option>
                        <option value="system">System</option>
                        <option value="remote-snapshot">Remote Snapshot</option>
                        <option value="alpaca-live-trading">Brokerage</option>
                        <option value="danger-zone">Danger Zone</option>
                    </select>
                </label>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 min-w-[160px]">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Active depth</p>
                    <p className="mt-1.5 font-semibold text-slate-200">{depthOptions.find(o => o.key === config.rss_article_detail_mode)?.label ?? "Normal"}</p>
                </div>
            </div>

            <div>
                <p className="text-xs text-slate-400 mb-3">Analysis depth & pipeline mode</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {depthOptions.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => setConfig((c) => ({ ...c, rss_article_detail_mode: option.key }))}
                            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                config.rss_article_detail_mode === option.key
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                    : "border-slate-800 bg-slate-950/60 text-slate-300"
                            }`}
                        >
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400 font-medium">{option.tagline}</p>
                            <p className="mt-1.5 text-[11px] text-slate-500">{option.pipeline}</p>
                        </button>
                    ))}
                </div>
            </div>

            {isAdvancedMode && (
            <div>
                <p className="text-xs text-slate-400 mb-3">Article volume — quick select</p>
                <p className="text-[11px] text-slate-500 mb-2">
                    Max posts ingested per analysis. Lower = faster Stage 2 (each post adds context tokens). Higher = broader signal coverage.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[5, 10, 15, 20].map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => setConfig((c) => ({ ...c, max_posts: n }))}
                            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                config.max_posts === n
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100 font-semibold"
                                    : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700"
                            }`}
                        >
                            {n}
                        </button>
                    ))}
                </div>
                <label className="mt-3 block">
                    <span className="text-[11px] text-slate-500">Custom value</span>
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={config.max_posts}
                        onChange={(e) => setConfig((c) => ({ ...c, max_posts: Math.max(1, Math.min(50, parseInt(e.target.value) || 1)) }))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                    />
                </label>
            </div>
            )}

            {isAdvancedMode && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.red_team_enabled}
                            onChange={(e) => setConfig((c) => ({ ...c, red_team_enabled: e.target.checked }))}
                            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="block">
                            <span className="text-sm font-semibold text-slate-200">Red-team risk review</span>
                            <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                                Adversarial pass that re-reads the blue-team signal looking for bias, source skew, and overlooked risks.
                                Disabling saves one Ollama call per analysis (~30-60s on a slow box) at the cost of the bias countercheck.
                            </span>
                        </span>
                    </label>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-200">Parallel Ollama slots</span>
                        <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                            Number of Stage 2 specialist calls that may run concurrently. <span className="font-semibold text-slate-200">1</span> = serialized (safe default).
                        </p>
                        <input
                            type="number"
                            min={1}
                            max={8}
                            value={config.ollama_parallel_slots}
                            onChange={(e) => setConfig((c) => ({ ...c, ollama_parallel_slots: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) }))}
                            className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        />
                        {config.ollama_parallel_slots > 1 && (
                            <p className="mt-2 text-[11px] text-amber-400 leading-relaxed">
                                ⚠ Requires GPU VRAM headroom AND <code className="font-mono text-amber-300">OLLAMA_NUM_PARALLEL={config.ollama_parallel_slots}</code> set on the Ollama side. Without both, Ollama will OOM or queue silently — undoing the speedup.
                            </p>
                        )}
                    </label>
                </div>
            </div>
            )}

            <div>
                <p className="text-xs text-slate-400 mb-3">Risk profile & leverage</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {riskOptions.map((option) => {
                        const isActive = (config.risk_profile || "aggressive") === option.key;
                        return (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => setConfig((c) => ({ ...c, risk_profile: option.key }))}
                                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                    isActive
                                        ? activeColorStyles[option.color]
                                        : "border-slate-800 bg-slate-950/60 text-slate-300"
                                }`}
                            >
                                <p className="text-sm font-semibold">{option.label}</p>
                                <p className="mt-0.5 text-[11px] text-slate-400 font-medium">{option.tagline}</p>
                                <p className="mt-1.5 text-[11px] text-slate-500">{option.description}</p>
                                <p className="mt-2 text-[10px] font-mono text-slate-600">{option.maxLeverage}</p>
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}