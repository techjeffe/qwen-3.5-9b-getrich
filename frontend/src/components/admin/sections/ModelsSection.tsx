"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type ModelsSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    hasAdvancedCustomizations: boolean;
    depthOptions: Array<{
        key: AppConfig["rss_article_detail_mode"];
        label: string;
        tagline: string;
        pipeline: string;
    }>;
};

export function ModelsSection({ config, setConfig, hasAdvancedCustomizations, depthOptions }: ModelsSectionProps) {
    const hasModels = config.available_models.length > 0;

    return (
        <section id="models" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">Model Orchestration</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Model selection follows the depth setting chosen above.
                </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={config.web_research_enabled}
                        onChange={(e) => setConfig((current) => ({ ...current, web_research_enabled: e.target.checked }))}
                        className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="block">
                        <span className="text-sm font-semibold text-slate-200">Light Web Research</span>
                        <span className="block mt-1 text-xs text-slate-400 leading-relaxed">
                            Fetch up to a few recent trusted web headlines per active symbol and inject them into the specialist prompt.
                            This is intentionally lightweight and meant for custom names like `NVDA` without pulling a huge feed universe.
                        </span>
                        <span className="block mt-2 text-[11px] text-slate-500">
                            Snapshot reruns reuse the saved web context so model comparisons stay fair.
                        </span>
                    </span>
                </label>
            </div>

            {hasModels ? (
                config.rss_article_detail_mode === "light" ? (
                    /* Light — one model for both stages */
                    <div className="space-y-3">
                        <p className="text-xs text-slate-400">
                            Light mode uses a single model for both entity mapping (Stage 1) and financial reasoning (Stage 2).
                            Pick a fast, small model for best throughput.
                        </p>
                        <label className="block">
                            <span className="text-xs text-slate-400">Analysis Model</span>
                            <select
                                value={config.extraction_model}
                                onChange={(e) => setConfig((c) => ({ ...c, extraction_model: e.target.value, reasoning_model: "" }))}
                                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                            >
                                <option value="">— use active Ollama model —</option>
                                {config.available_models.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </label>
                        {config.extraction_model && (
                            <div className="rounded-xl border border-slate-700/50 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 space-y-0.5">
                                <p><span className="text-slate-500">Stage 1 (entity mapping) — </span>{config.extraction_model}</p>
                                <p><span className="text-slate-500">Stage 2 (reasoning) — </span>{config.extraction_model}</p>
                            </div>
                        )}
                    </div>
                ) : config.rss_article_detail_mode === "detailed" ? (
                    /* Detailed — two models required */
                    <div className="space-y-4">
                        <p className="text-xs text-slate-400">
                            Detailed mode always runs the full two-stage pipeline. Both models are required.
                            Use a fast small model for Stage 1 and your best reasoning model for Stage 2.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <label className="block">
                                <span className="text-xs text-slate-400">
                                    Stage 1 — Extraction Model
                                    {!config.extraction_model && <span className="ml-2 text-amber-400">required</span>}
                                </span>
                                <p className="text-[11px] text-slate-600 mt-0.5">Entity mapping & article filtering (e.g. llama3.2:3b)</p>
                                <select
                                    value={config.extraction_model}
                                    onChange={(e) => setConfig((c) => ({ ...c, extraction_model: e.target.value }))}
                                    className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none focus:border-blue-400 bg-slate-800 ${!config.extraction_model ? "border-amber-700/60" : "border-slate-700"}`}
                                >
                                    <option value="">— choose a model —</option>
                                    {config.available_models.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-400">
                                    Stage 2 — Reasoning Model
                                    {!config.reasoning_model && <span className="ml-2 text-amber-400">required</span>}
                                </span>
                                <p className="text-[11px] text-slate-600 mt-0.5">Financial signal generation (e.g. qwen3:9b)</p>
                                <select
                                    value={config.reasoning_model}
                                    onChange={(e) => setConfig((c) => ({ ...c, reasoning_model: e.target.value }))}
                                    className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm text-white outline-none focus:border-blue-400 bg-slate-800 ${!config.reasoning_model ? "border-amber-700/60" : "border-slate-700"}`}
                                >
                                    <option value="">— choose a model —</option>
                                    {config.available_models.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {config.extraction_model && config.reasoning_model && (
                            <div className="rounded-xl border border-blue-800/40 bg-blue-500/5 px-4 py-3 text-xs text-slate-300 space-y-0.5">
                                <p className="font-semibold text-blue-300 mb-1">Two-stage pipeline ready</p>
                                <p><span className="text-slate-500">Stage 1 — </span>{config.extraction_model}</p>
                                <p><span className="text-slate-500">Stage 2 — </span>{config.reasoning_model}</p>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Normal — two models optional */
                    <div className="space-y-4">
                        <p className="text-xs text-slate-400">
                            Normal mode runs two-stage when both models are set, single-stage otherwise.
                            Leave blank to use whichever Ollama model is currently active.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <label className="block">
                                <span className="text-xs text-slate-400">Stage 1 — Extraction Model <span className="text-slate-600">(optional)</span></span>
                                <p className="text-[11px] text-slate-600 mt-0.5">Entity mapping & article filtering (e.g. llama3.2:3b)</p>
                                <select
                                    value={config.extraction_model}
                                    onChange={(e) => setConfig((c) => ({ ...c, extraction_model: e.target.value }))}
                                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                >
                                    <option value="">— use active Ollama model —</option>
                                    {config.available_models.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="text-xs text-slate-400">Stage 2 — Reasoning Model <span className="text-slate-600">(optional)</span></span>
                                <p className="text-[11px] text-slate-600 mt-0.5">Financial signal generation (e.g. qwen3:9b)</p>
                                <select
                                    value={config.reasoning_model}
                                    onChange={(e) => setConfig((c) => ({ ...c, reasoning_model: e.target.value }))}
                                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                >
                                    <option value="">— use active Ollama model —</option>
                                    {config.available_models.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {(config.extraction_model || config.reasoning_model) && (
                            <div className="rounded-xl border border-slate-700/50 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 space-y-0.5">
                                {config.extraction_model && config.reasoning_model ? (
                                    <>
                                        <p className="font-semibold text-blue-300 mb-1">Two-stage pipeline active</p>
                                        <p><span className="text-slate-500">Stage 1 — </span>{config.extraction_model}</p>
                                        <p><span className="text-slate-500">Stage 2 — </span>{config.reasoning_model}</p>
                                    </>
                                ) : (
                                    <p className="text-amber-400">Single-stage mode — set both models to enable two-stage pipeline.</p>
                                )}
                            </div>
                        )}
                    </div>
                )
            ) : (
                <p className="text-xs text-amber-400 italic">No Ollama models detected — make sure Ollama is running.</p>
            )}
        </section>
    );
}