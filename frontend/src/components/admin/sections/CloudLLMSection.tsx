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

// ── Provider definitions ──────────────────────────────────────────────

type ProviderDef = {
    value: string;
    label: string;
    tagline: string;
};

const CLOUD_PROVIDERS: ProviderDef[] = [
    { value: "openrouter", label: "OpenRouter", tagline: "Multi-model gateway" },
    { value: "anthropic", label: "Anthropic", tagline: "Claude models" },
    { value: "openai", label: "OpenAI", tagline: "GPT models" },
    { value: "google", label: "Google", tagline: "Gemini models" },
    { value: "custom", label: "Custom", tagline: "Bring your own endpoint" },
];

const LOCAL_PROVIDERS: ProviderDef[] = [
    { value: "ollama", label: "Ollama", tagline: "Local LLM server" },
    { value: "vllm", label: "vLLM", tagline: "OpenAI-compatible local" },
    { value: "llama.cpp", label: "llama.cpp", tagline: "C++ inference server" },
    { value: "custom", label: "Custom", tagline: "Bring your own endpoint" },
];

type ProviderUrls = Record<string, string>;

const CLOUD_URLS: ProviderUrls = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    openrouter: "https://openrouter.ai/api/v1",
    google: "https://generativelanguage.googleapis.com",
};

const LOCAL_URLS: ProviderUrls = {
    ollama: "http://localhost:11434",
    vllm: "http://localhost:8000",
    "llama.cpp": "http://localhost:8080",
};

function smartFillUrl(mode: "cloud" | "local", provider: string): string {
    const map = mode === "cloud" ? CLOUD_URLS : LOCAL_URLS;
    return map[provider] ?? "";
}

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

    // ── Derived state ───────────────────────────────────────────────────
    const currentProviders = config.api_mode === "cloud" ? CLOUD_PROVIDERS : LOCAL_PROVIDERS;
    const currentProvider = config.api_mode === "cloud" ? config.cloud_provider : config.local_provider;
    // For protocol validation, "custom" means the user is typing their own URL
    const userIsTypingUrl = currentProvider === "custom" || config.user_edited_url;

    // ── Protocol validation ─────────────────────────────────────────────
    const protocolError = useMemo<string | null>(() => {
        const url = config.api_url?.trim() ?? "";
        if (!url) return null; // empty field, no warning yet
        if (config.api_mode === "cloud" && !url.startsWith("https://")) {
            return "Cloud endpoints require https:// for security";
        }
        if (config.api_mode === "local" && !url.startsWith("http://")) {
            return "Local endpoints should use http://";
        }
        return null;
    }, [config.api_url, config.api_mode]);

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

    // ── Track last-used local models so we can restore them when switching back from cloud ──
    const lastLocalModelsRef = useRef<{ extraction: string; reasoning: string }>({
        extraction: config.extraction_model,
        reasoning: config.reasoning_model,
    });

    // ── When backend changes, auto-select models available on that backend ──
    const prevBackendRef = useRef(config.inference_backend);
    useEffect(() => {
        const prev = prevBackendRef.current;
        const currentBackend = config.inference_backend;
        if (prev === currentBackend) return;
        prevBackendRef.current = currentBackend;

        // Save last-used local models before switching away from local
        if (prev !== "openai") {
            lastLocalModelsRef.current = {
                extraction: config.extraction_model,
                reasoning: config.reasoning_model,
            };
        }

        // Determine which model pool is relevant for the new backend
        const availableModels = currentBackend === "openai"
            ? cloudModels
            : config.local_models;

        if (availableModels.length === 0) return;

        const availableSet = new Set(availableModels);

        setConfig((c) => {
            const next = { ...c };
            let changed = false;

            const pick = (current: string): string => {
                if (current && availableSet.has(current)) return current;
                if (currentBackend !== "openai") {
                    const lastLocal = lastLocalModelsRef.current;
                    if (lastLocal.extraction && availableSet.has(lastLocal.extraction)) return lastLocal.extraction;
                    if (lastLocal.reasoning && availableSet.has(lastLocal.reasoning)) return lastLocal.reasoning;
                }
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
    }, [config.inference_backend, cloudModels, config.local_models, setConfig]);

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

    // Auto-fetch cloud models when cloud mode is active, secrets are configured, and models not yet loaded
    useEffect(() => {
        if (config.api_mode === "cloud" && secrets.configured && cloudModels.length === 0 && !isLoadingCloudModels) {
            void fetchCloudModels();
        }
    }, [config.api_mode, secrets.configured, cloudModels.length, isLoadingCloudModels, fetchCloudModels]);

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

    // ── API mode toggle handler (Cloud ↔ Local) ──────────────────────
    const handleApiModeChange = (mode: "cloud" | "local") => {
        if (mode === config.api_mode) return;
        setConfig((c) => {
            const newProvider = mode === "cloud" ? c.cloud_provider : c.local_provider;
            // Only smart-fill if user hasn't manually edited the URL
            // or the URL would be empty/invalid for the new mode
            const currentUrl = c.api_url?.trim() ?? "";
            const fillUrl = smartFillUrl(mode, newProvider);
            const wasEdited = c.user_edited_url;

            // Determine if we should overwrite: if user never edited, or if the old URL
            // makes no sense in the new mode (e.g., http URL when switching to cloud)
            const oldIsHttp = currentUrl.startsWith("http://");
            const oldIsHttps = currentUrl.startsWith("https://");
            const modeMismatch = (mode === "cloud" && oldIsHttp) || (mode === "local" && oldIsHttps);

            const newUrl = (!wasEdited || modeMismatch || !currentUrl) ? fillUrl : currentUrl;

            return {
                ...c,
                api_mode: mode,
                api_url: newUrl,
                // Reset edited flag if we're filling new content
                user_edited_url: wasEdited && !modeMismatch && currentUrl !== "",
            };
        });
    };

    // ── Provider change handler (smart-fill URL) ─────────────────────
    const handleProviderChange = (provider: string) => {
        setConfig((c) => {
            const fillUrl = smartFillUrl(c.api_mode, provider);
            // Smart-fill always on provider change, regardless of edit history
            return {
                ...c,
                ...(c.api_mode === "cloud" ? { cloud_provider: provider } : { local_provider: provider }),
                api_url: fillUrl,
                // If it's "custom", user will edit, so flag accordingly
                // For known providers, reset edit flag since we just filled
                user_edited_url: provider === "custom" ? c.user_edited_url : false,
            };
        });
    };

    // ── URL manual edit handler ───────────────────────────────────────
    const handleUrlChange = (url: string) => {
        setConfig((c) => ({
            ...c,
            api_url: url,
            user_edited_url: true,
        }));
    };

    // ── All model options for dropdown: local + cloud, deduplicated ───
    const allModelOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: { value: string; label: string }[] = [];

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

    // ── Mapping for old inference_backend
    const activeBackend = config.inference_backend || "ollama";
    const isCloudMode = config.api_mode === "cloud";

    return (
        <section id="cloud-llm" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <div>
                <h2 className="text-sm font-semibold text-slate-200">LLM Configuration</h2>
                <p className="text-xs text-slate-500 mt-1">
                    Choose between cloud and local inference, then pick your provider.
                    The API URL is auto-populated — you can override it if needed.
                </p>
            </div>

            {/* ── Cloud / Local Toggle ───────────────────────────────── */}
            <div>
                <p className="text-xs text-slate-400 mb-3">API mode</p>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => handleApiModeChange("cloud")}
                        className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                            isCloudMode
                                ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700"
                        }`}
                    >
                        <p className="text-sm font-semibold">☁️ Cloud</p>
                        <p className="mt-0.5 text-[11px] text-slate-400 font-medium">
                            OpenAI, Anthropic, OpenRouter, Google
                        </p>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                            Remote API endpoints. Requires an API key. HTTPS enforced.
                        </p>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleApiModeChange("local")}
                        className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                            !isCloudMode
                                ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                                : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700"
                        }`}
                    >
                        <p className="text-sm font-semibold">🖥️ Local</p>
                        <p className="mt-0.5 text-[11px] text-slate-400 font-medium">
                            Ollama, vLLM, llama.cpp
                        </p>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                            Self-hosted inference. No API key needed. HTTP allowed.
                        </p>
                    </button>
                </div>
            </div>

            {/* ── Settings panel ─────────────────────────────────────── */}
            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                {/* ── Provider dropdown ─────────────────────────────── */}
                <div>
                    <label className="block">
                        <span className="text-xs text-slate-400">
                            {isCloudMode ? "Cloud Provider" : "Local Provider"}
                        </span>
                        <select
                            value={currentProvider}
                            onChange={(e) => handleProviderChange(e.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                        >
                            {currentProviders.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label} — {p.tagline}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                {/* ── API URL with smart-fill ───────────────────────── */}
                <label className="block">
                    <span className="text-xs text-slate-400">API URL</span>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                        Auto-populated from provider selection.
                        Edit manually to use a custom endpoint.
                        {isCloudMode
                            ? " HTTPS required for cloud providers."
                            : " HTTP is standard for local servers."}
                    </p>
                    <div className="relative mt-2">
                        <input
                            type="text"
                            value={config.api_url ?? ""}
                            onChange={(e) => handleUrlChange(e.target.value)}
                            placeholder={isCloudMode ? "https://api.openai.com/v1" : "http://localhost:11434"}
                            className={`w-full rounded-lg border bg-slate-800 px-3 py-2 text-sm text-white outline-none font-mono transition-colors ${
                                protocolError
                                    ? "border-red-500 focus:border-red-400"
                                    : "border-slate-700 focus:border-blue-400"
                            }`}
                        />
                        {config.user_edited_url && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 font-medium">
                                custom
                            </span>
                        )}
                    </div>
                    {protocolError && (
                        <p className="mt-1.5 text-[11px] text-red-400 flex items-center gap-1">
                            <span>⚠</span>
                            <span>{protocolError}</span>
                        </p>
                    )}
                    {!protocolError && config.user_edited_url && (
                        <p className="mt-1 text-[11px] text-amber-500">
                            Custom URL — provider changes won't overwrite until you select a different provider.
                        </p>
                    )}
                </label>

                {/* ── Cloud-specific: model & API key ────────────────── */}
                {isCloudMode ? (
                    <>
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
                    </>
                ) : (
                    <>
                        {/* ── Local-specific: per-provider docs ──────── */}
                        <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
                            <p className="font-medium text-slate-400 mb-1">
                                {currentProvider === "ollama"
                                    ? "Ollama"
                                    : currentProvider === "vllm"
                                        ? "vLLM"
                                        : currentProvider === "llama.cpp"
                                            ? "llama.cpp"
                                            : "Custom Local"}{" "}
                                endpoint
                            </p>
                            {currentProvider === "ollama" && (
                                <p>
                                    Uses Ollama's /api/generate endpoint. Make sure the Ollama server is running.
                                    Default port: <code className="font-mono text-slate-300">11434</code>.
                                </p>
                            )}
                            {currentProvider === "vllm" && (
                                <p>
                                    Uses vLLM's OpenAI-compatible /v1/completions endpoint.
                                    Default port: <code className="font-mono text-slate-300">8000</code>.
                                </p>
                            )}
                            {currentProvider === "llama.cpp" && (
                                <p>
                                    Uses llama.cpp server with an OpenAI-compatible API.
                                    Default port: <code className="font-mono text-slate-300">8080</code>.
                                </p>
                            )}
                            {currentProvider === "custom" && (
                                <p>
                                    Enter the full URL to your local inference server's API endpoint.
                                    Must start with <code className="font-mono text-slate-300">http://</code>.
                                </p>
                            )}
                        </div>

                        {/* Per-stage model overrides note (same for both modes) */}
                        <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
                            <p className="font-medium text-slate-400 mb-1">Per-stage model overrides</p>
                            <p>
                                Use the <strong className="text-slate-300">Model Orchestration</strong> section to set separate models for Stage 1 (extraction) and Stage 2 (reasoning).
                                When those are set, they override the default model above.
                            </p>
                            <p className="mt-2">
                                Example: use <code className="font-mono text-slate-300">llama3.2:3b</code> for Stage 1 and <code className="font-mono text-slate-300">qwen3:9b</code> for Stage 2.
                            </p>
                        </div>
                    </>
                )}

                {/* ── Advanced: env var fallback note ────────────────── */}
                {isAdvancedMode && isCloudMode && (
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

                {isAdvancedMode && !isCloudMode && (
                    <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
                        <p className="font-medium text-slate-400 mb-1">Environment variable fallback</p>
                        <p>
                            URL can also be set via{' '}
                            <code className="font-mono text-slate-300">{currentProvider === "ollama" ? "OLLAMA_URL" : "VLLM_URL"}</code>.
                            When the admin field is empty, the env var is used, then the hardcoded default.
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
        </section>
    );
}