"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppConfig } from "@/lib/utils/config-normalizer";

type CloudLLMSecretsStatus = {
    available: boolean;
    configured: boolean;
    api_key_masked: string;
    error: string;
};

type CloudLLMSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    isAdvancedMode: boolean;
};

/** Return a model tagged for display: "(local) model-name" or "(cloud) model-name". */
function modelDisplayName(model: string, localModels: Set<string>, cloudModels: Set<string>): string {
    if (cloudModels.has(model)) return `(cloud) ${model}`;
    if (localModels.has(model)) return `(local) ${model}`;
    return model;
}

export function CloudLLMSection({ config, setConfig, isAdvancedMode }: CloudLLMSectionProps) {
    const [secrets, setSecrets] = useState<CloudLLMSecretsStatus>({
        available: false,
        configured: false,
        api_key_masked: "",
        error: "",
    });
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState("");

    // ── Cloud models fetched on demand ─────────────────────────────────
    const [cloudModels, setCloudModels] = useState<string[]>([]);
    const [isLoadingCloudModels, setIsLoadingCloudModels] = useState(false);
    const [cloudModelsError, setCloudModelsError] = useState("");

    const localModelsSet = useMemo(() => new Set(config.local_models), [config.local_models]);
    const cloudModelsSet = useMemo(() => new Set(cloudModels), [cloudModels]);

    const fetchCloudModels = useCallback(async (showLoading = true) => {
        if (showLoading) setIsLoadingCloudModels(true);
        setCloudModelsError("");
        try {
            const res = await fetch("/api/admin/models", { cache: "no-store" });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                setCloudModelsError(payload?.error || "Failed to load cloud models");
                return;
            }
            const payload = await res.json();
            const models = Array.isArray(payload.cloud_models) ? payload.cloud_models : [];
            setCloudModels(models);
            if (models.length === 0) {
                setCloudModelsError("No cloud models available — check your API key and base URL.");
            }
        } catch {
            setCloudModelsError("Network error loading cloud models");
        } finally {
            if (showLoading) setIsLoadingCloudModels(false);
        }
    }, []);

    // ── Backend selector options ──────────────────────────────────────
    const backendOptions: Array<{
        value: string;
        label: string;
        tagline: string;
        description: string;
    }> = [
            {
                value: "ollama",
                label: "Ollama",
                tagline: "Local LLM server",
                description: "Default. Uses Ollama's /api/generate endpoint. Best for local GPU inference with Llama, Qwen, or Qwen3 models.",
            },
            {
                value: "vllm",
                label: "vLLM",
                tagline: "Local OpenAI-compatible",
                description: "Uses vLLM's /v1/completions endpoint. For local servers running vLLM, TGI, or SGLang with an OpenAI-compatible API.",
            },
            {
                value: "openai",
                label: "Cloud LLM",
                tagline: "OpenAI or any OpenAI-compatible cloud",
                description: "Uses the OpenAI Chat Completions API. Works with OpenAI, Together AI, Groq, Fireworks, DeepSeek, and any OpenAI-compatible provider.",
            },
        ];
    const activeBackend = config.inference_backend || "ollama";

    // ── Track last-used local models so we can restore them when switching back from cloud ──
    const lastLocalModelsRef = useRef<{ extraction: string; reasoning: string }>({
        extraction: config.extraction_model,
        reasoning: config.reasoning_model,
    });

    // ── When backend changes, auto-select models available on that backend ──
    const prevBackendRef = useRef(activeBackend);
    useEffect(() => {
        const prev = prevBackendRef.current;
        if (prev === activeBackend) return;
        prevBackendRef.current = activeBackend;

        // Save last-used local models before switching away from local
        if (prev !== "openai") {
            lastLocalModelsRef.current = {
                extraction: config.extraction_model,
                reasoning: config.reasoning_model,
            };
        }

        // Determine which model pool is relevant for the new backend
        const availableModels = activeBackend === "openai"
            ? cloudModels
            : config.local_models;

        if (availableModels.length === 0) return;

        const availableSet = new Set(availableModels);

        setConfig((c) => {
            const next = { ...c };
            let changed = false;

            // Helper: if the current model isn't available on the new backend, pick a suitable one
            const pick = (current: string): string => {
                if (current && availableSet.has(current)) return current; // keep it
                // For local backends, try to restore the last-used local model
                if (activeBackend !== "openai") {
                    const lastLocal = lastLocalModelsRef.current;
                    if (lastLocal.extraction && availableSet.has(lastLocal.extraction)) return lastLocal.extraction;
                    if (lastLocal.reasoning && availableSet.has(lastLocal.reasoning)) return lastLocal.reasoning;
                }
                // Fall back to first available model
                return availableModels[0];
            };

            const newExtraction = pick(c.extraction_model);
            if (newExtraction !== c.extraction_model) {
                next.extraction_model = newExtraction;
                changed = true;
            }

            const newReasoning = pick(c.reasoning_model);
            if (newReasoning !== c.reasoning_model) {
                next.reasoning_model = newReasoning;
                changed = true;
            }

            return changed ? next : c;
        });
    }, [activeBackend, cloudModels, config.local_models, setConfig]);

    // ── Fetch secret status on mount ──────────────────────────────────
    const fetchSecrets = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/openai-secrets", { cache: "no-store" });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setSecrets((s) => ({ ...s, available: false, configured: false, error: payload?.error || "Failed to load" }));
                return;
            }
            setSecrets({
                available: !!payload.available,
                configured: !!payload.configured,
                api_key_masked: String(payload.api_key_masked || ""),
                error: String(payload.error || ""),
            });
        } catch {
            setSecrets((s) => ({ ...s, available: false, configured: false, error: "Network error" }));
        }
    }, []);

    useEffect(() => { void fetchSecrets(); }, [fetchSecrets]);

    // Auto-fetch cloud models when the openai backend becomes active and secrets are configured
    useEffect(() => {
        if (activeBackend === "openai" && secrets.configured && cloudModels.length === 0 && !isLoadingCloudModels) {
            void fetchCloudModels();
        }
    }, [activeBackend, secrets.configured, cloudModels.length, isLoadingCloudModels, fetchCloudModels]);

    // ── Save API key ──────────────────────────────────────────────────
    const saveApiKey = async () => {
        if (!apiKeyInput.trim()) {
            setStatus("API key is required");
            return;
        }
        setIsSaving(true);
        setStatus("");
        try {
            const res = await fetch("/api/admin/openai-secrets", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ api_key: apiKeyInput.trim() }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(payload?.detail || payload?.error || "Failed to save");
                return;
            }
            setSecrets({
                available: !!payload.available,
                configured: !!payload.configured,
                api_key_masked: String(payload.api_key_masked || ""),
                error: String(payload.error || ""),
            });
            setApiKeyInput("");
            setStatus("API key saved to OS keychain.");
            // Refresh cloud models now that we have an API key
            void fetchCloudModels();
        } catch {
            setStatus("Failed to save API key");
        } finally {
            setIsSaving(false);
        }
    };

    // ── Clear API key ─────────────────────────────────────────────────
    const clearApiKey = async () => {
        setIsSaving(true);
        setStatus("");
        try {
            const res = await fetch("/api/admin/openai-secrets", { method: "DELETE" });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus(payload?.error || "Failed to clear");
                return;
            }
            setSecrets({
                available: !!payload.available,
                configured: !!payload.configured,
                api_key_masked: String(payload.api_key_masked || ""),
                error: String(payload.error || ""),
            });
            setApiKeyInput("");
            setCloudModels([]);
            setStatus("API key cleared from OS keychain.");
        } catch {
            setStatus("Failed to clear API key");
        } finally {
            setIsSaving(false);
        }
    };

    // ── All model options for dropdown: local + cloud, deduplicated ───
    const allModelOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: { value: string; label: string }[] = [];

        // Local models first, then cloud models
        for (const m of config.local_models) {
            if (!seen.has(m)) {
                seen.add(m);
                options.push({ value: m, label: `(local) ${m}` });
            }
        }
        for (const m of cloudModels) {
            if (!seen.has(m)) {
                seen.add(m);
                options.push({ value: m, label: `(cloud) ${m}` });
            }
        }
        return options;
    }, [config.local_models, cloudModels]);

    const showCloudModelDropdown = cloudModels.length > 0 || isLoadingCloudModels || cloudModelsError;

    return (
        <section id="cloud-llm" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">LLM Configuration</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Choose your inference backend and configure endpoint URLs and API access. Values set here override the corresponding environment variables.
                </p>
            </div>

            {/* ── Backend selector ──────────────────────────────────── */}
            <div>
                <p className="text-xs text-slate-400 mb-3">Inference backend</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {backendOptions.map((option) => {
                        const isActive = activeBackend === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setConfig((c) => ({ ...c, inference_backend: option.value }))}
                                className={`rounded-xl border px-4 py-3 text-left transition-colors ${isActive
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                    : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700"
                                    }`}
                            >
                                <p className="text-sm font-semibold">{option.label}</p>
                                <p className="mt-0.5 text-[11px] text-slate-400 font-medium">{option.tagline}</p>
                                <p className="mt-1.5 text-[11px] text-slate-500">{option.description}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Ollama settings (when ollama selected) ────────────── */}
            {activeBackend === "ollama" && (
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <label className="block">
                        <span className="text-xs text-slate-400">Ollama URL</span>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                            Endpoint for Ollama's /api/generate. Leave blank to use the <code className="font-mono">OLLAMA_URL</code> environment variable or default (<code className="font-mono">http://localhost:11434/api/generate</code>).
                        </p>
                        <input
                            type="text"
                            value={config.ollama_url || ""}
                            onChange={(e) => setConfig((c) => ({ ...c, ollama_url: e.target.value }))}
                            placeholder="http://localhost:11434/api/generate"
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 font-mono"
                        />
                    </label>
                    {config.ollama_url && (
                        <p className="text-[11px] text-amber-400">Overrides the OLLAMA_URL environment variable.</p>
                    )}
                </div>
            )}

            {/* ── vLLM settings (when vllm selected) ────────────────── */}
            {activeBackend === "vllm" && (
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <label className="block">
                        <span className="text-xs text-slate-400">vLLM URL</span>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                            Endpoint for vLLM's /v1/completions. Leave blank to use the <code className="font-mono">VLLM_URL</code> environment variable or default (<code className="font-mono">http://localhost:8000</code>).
                        </p>
                        <input
                            type="text"
                            value={config.vllm_url || ""}
                            onChange={(e) => setConfig((c) => ({ ...c, vllm_url: e.target.value }))}
                            placeholder="http://localhost:8000"
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 font-mono"
                        />
                    </label>
                    {config.vllm_url && (
                        <p className="text-[11px] text-amber-400">Overrides the VLLM_URL environment variable.</p>
                    )}
                </div>
            )}

            {/* ── OpenAI / Cloud LLM settings (only when openai selected) ── */}
            {activeBackend === "openai" && (
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    {/* Base URL */}
                    <label className="block">
                        <span className="text-xs text-slate-400">Base URL</span>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                            OpenAI-compatible API endpoint. HTTP is allowed for local servers; HTTPS required for public endpoints.
                            For OpenRouter, use: <code className="font-mono">https://openrouter.ai/api/v1</code>
                        </p>
                        <input
                            type="text"
                            value={config.openai_base_url || "https://api.openai.com/v1"}
                            onChange={(e) => setConfig((c) => ({ ...c, openai_base_url: e.target.value }))}
                            placeholder="https://api.openai.com/v1"
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 font-mono"
                        />
                    </label>

                    {/* Default model — dropdown when cloud models loaded, text input otherwise */}
                    <label className="block">
                        <span className="text-xs text-slate-400">Default model</span>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                            Used when no per-stage model is selected. <code className="font-mono">gpt-4o-mini</code> is the default.
                        </p>

                        {showCloudModelDropdown ? (
                            <div className="flex gap-2 items-start mt-2">
                                <div className="flex-1">
                                    <select
                                        value={config.openai_model || "gpt-4o-mini"}
                                        onChange={(e) => setConfig((c) => ({ ...c, openai_model: e.target.value }))}
                                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                                    >
                                        <option value="gpt-4o-mini">gpt-4o-mini (default)</option>
                                        {allModelOptions.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                    {isLoadingCloudModels && (
                                        <p className="text-[11px] text-slate-500 mt-1">Loading cloud models…</p>
                                    )}
                                    {cloudModelsError && cloudModels.length === 0 && (
                                        <p className="text-[11px] text-amber-400 mt-1">{cloudModelsError}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => fetchCloudModels(true)}
                                    disabled={isLoadingCloudModels}
                                    className="mt-0 shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                                >
                                    {isLoadingCloudModels ? "⟳" : "↻"}
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2 items-start mt-2">
                                <input
                                    type="text"
                                    value={config.openai_model || "gpt-4o-mini"}
                                    onChange={(e) => setConfig((c) => ({ ...c, openai_model: e.target.value }))}
                                    placeholder="gpt-4o-mini"
                                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={() => fetchCloudModels(true)}
                                    disabled={isLoadingCloudModels}
                                    className="mt-0 shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                                >
                                    {isLoadingCloudModels ? "⟳" : "↻ Load models"}
                                </button>
                            </div>
                        )}

                        {cloudModels.length > 0 && (
                            <p className="text-[11px] text-slate-500 mt-2">
                                {cloudModels.length} cloud model{cloudModels.length !== 1 ? "s" : ""} available
                                {config.local_models.length > 0 && ` + ${config.local_models.length} local`}
                            </p>
                        )}
                    </label>

                    {/* Per-stage model overrides note */}
                    <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
                        <p className="font-medium text-slate-400 mb-1">Per-stage model overrides</p>
                        <p>
                            Use the <strong className="text-slate-300">Model Orchestration</strong> section to set separate models for Stage 1 (extraction) and Stage 2 (reasoning).
                            When those are set, they override the default model above.
                        </p>
                        <p className="mt-2">
                            Example: use <code className="font-mono text-slate-300">gpt-4o-mini</code> for Stage 1 keyword generation and <code className="font-mono text-slate-300">gpt-4o</code> for Stage 2 financial reasoning.
                        </p>
                    </div>

                    {/* API key */}
                    <div className="pt-1">
                        <span className="text-xs text-slate-400">API Key</span>
                        <div className="mt-2 flex flex-col gap-3">
                            {secrets.configured ? (
                                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5">
                                    <span className="text-xs text-slate-400">
                                        <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                                        Configured: <code className="font-mono text-slate-300">{secrets.api_key_masked}</code>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={clearApiKey}
                                        disabled={isSaving}
                                        className="rounded-lg border border-red-800 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                                    >
                                        {isSaving ? "Clearing…" : "Clear"}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="password"
                                        value={apiKeyInput}
                                        onChange={(e) => setApiKeyInput(e.target.value)}
                                        placeholder="sk-..."
                                        className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 font-mono"
                                        autoComplete="off"
                                    />
                                    <button
                                        type="button"
                                        onClick={saveApiKey}
                                        disabled={isSaving || !apiKeyInput.trim()}
                                        className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                                    >
                                        {isSaving ? "Saving…" : "Save API Key"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Advanced: env var fallback note */}
                    {isAdvancedMode && (
                        <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
                            <p className="font-medium text-slate-400 mb-1">Environment variable fallback</p>
                            <p>
                                The API key is looked up from the OS keychain first, then falls back to
                                the <code className="font-mono text-slate-300">OPENAI_API_KEY</code> environment variable.
                                Base URL and model can also be set via <code className="font-mono text-slate-300">OPENAI_BASE_URL</code> and{' '}
                                <code className="font-mono text-slate-300">OPENAI_MODEL</code>.
                            </p>
                        </div>
                    )}

                    {/* Status */}
                    {status && (
                        <div className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300">
                            {status}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}