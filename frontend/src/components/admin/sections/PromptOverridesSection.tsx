"use client";

import { AppConfig } from "@/lib/utils/config-normalizer";

type PromptOverridesSectionProps = {
    config: AppConfig;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
    updatePromptOverride: (symbol: string, value: string) => void;
};

export function PromptOverridesSection({ config, setConfig, updatePromptOverride }: PromptOverridesSectionProps) {
    return (
        <section id="prompts" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            <h2 className="text-sm font-semibold text-slate-200">Prompt Overrides</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {config.tracked_symbols.map((symbol) => (
                    <label key={symbol} className="block">
                        <span className="text-xs text-slate-400">{symbol} specialist prompt</span>
                        <textarea
                            rows={6}
                            value={config.symbol_prompt_overrides[symbol] ?? ""}
                            onChange={(e) => updatePromptOverride(symbol, e.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                            placeholder={`Additional guidance for ${symbol}...`}
                        />
                    </label>
                ))}
            </div>
        </section>
    );
}