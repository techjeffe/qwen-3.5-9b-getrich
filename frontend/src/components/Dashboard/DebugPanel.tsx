"use client";

import GlassCard from "./GlassCard";
import { AnalysisResult } from "@/lib/types/analysis";
import { compactReasoning } from "@/lib/utils/formatters";
import { ChevronRight, ChevronDown, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

interface DebugPanelProps {
    result: AnalysisResult;
}

export default function DebugPanel({ result }: DebugPanelProps) {
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        modelInputs: false,
        redTeamDebug: false,
        ingestionTrace: false,
        marketValidation: false,
    });
    const [showRawJson, setShowRawJson] = useState(false);

    const toggleSection = (section: string) => {
        setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const sections = [
        {
            key: "modelInputs",
            label: "Model Inputs",
            content: result.model_inputs,
            visible: !!result.model_inputs,
        },
        {
            key: "redTeamDebug",
            label: "Red Team Debug",
            content: result.red_team_debug,
            visible: !!result.red_team_debug,
        },
        {
            key: "ingestionTrace",
            label: "Ingestion Trace",
            content: result.ingestion_trace,
            visible: !!result.ingestion_trace,
        },
        {
            key: "marketValidation",
            label: "Market Validation",
            content: result.market_validation,
            visible: Object.keys(result.market_validation).length > 0,
        },
    ].filter((s) => s.visible);

    return (
        <GlassCard>
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-300">Debug Panel</h2>
                <button
                    type="button"
                    onClick={() => setShowRawJson(!showRawJson)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                    {showRawJson ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showRawJson ? "Hide JSON" : "Show JSON"}
                </button>
            </div>

            {showRawJson ? (
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => copyToClipboard(JSON.stringify(result, null, 2))}
                        className="absolute top-2 right-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <Copy size={14} />
                    </button>
                    <pre className="max-h-[600px] overflow-auto text-[10px] text-slate-400 font-mono bg-slate-900/50 p-4 rounded-lg border border-slate-700/40">
                        {JSON.stringify(result, null, 2)}
                    </pre>
                </div>
            ) : (
                <div className="space-y-3">
                    {sections.map((section) => {
                        const isExpanded = expandedSections[section.key];
                        const content = section.content as Record<string, any>;

                        return (
                            <div
                                key={section.key}
                                className="rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleSection(section.key)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800/50 transition-colors"
                                >
                                    <span>{section.label}</span>
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>

                                {isExpanded && content && (
                                    <div className="px-4 pb-4 space-y-3">
                                        {section.key === "modelInputs" && (
                                            <>
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Articles</p>
                                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                                        {(content.articles as any[]).map((article: any, idx: number) => (
                                                            <div key={idx} className="text-xs text-slate-400">
                                                                <span className="font-mono text-slate-500">[{idx}]</span>{" "}
                                                                {article.title}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                {content.per_symbol_prompts && (
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Per-Symbol Prompts</p>
                                                        {Object.entries(content.per_symbol_prompts).map(([key, value]) => (
                                                            <div key={key} className="mb-2">
                                                                <p className="text-xs font-mono text-blue-400 mb-1">{key}:</p>
                                                                <p className="text-xs text-slate-400">{String(value)}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {section.key === "redTeamDebug" && (
                                            <>
                                                {content.signal_changes && (
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Signal Changes</p>
                                                        {(content.signal_changes as any[]).map((change: any, idx: number) => (
                                                            <div key={idx} className="mb-2 p-2 rounded bg-slate-900/50">
                                                                <p className="text-xs font-mono text-slate-300">{change.symbol}</p>
                                                                <p className="text-xs text-slate-400">
                                                                    {change.blue_team_recommendation} → {change.consensus_recommendation}
                                                                </p>
                                                                {change.changed && (
                                                                    <span className="text-xs font-bold text-amber-400">Changed: {change.change_type}</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {section.key === "ingestionTrace" && (
                                            <>
                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                    <div>
                                                        <span className="text-slate-500">Total Items: </span>
                                                        <span className="font-mono text-slate-300">{content.total_items}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Selected: </span>
                                                        <span className="font-mono text-slate-300">{content.selected_article_ids?.length ?? 0}</span>
                                                    </div>
                                                </div>
                                                {content.selected_urls && (
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Selected URLs</p>
                                                        <div className="max-h-40 overflow-y-auto space-y-1">
                                                            {(content.selected_urls as string[]).map((url: string, idx: number) => (
                                                                <p key={idx} className="text-[10px] font-mono text-slate-500 break-all">
                                                                    {idx + 1}. {url}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {section.key === "marketValidation" && (
                                            <div className="space-y-2">
                                                {Object.entries(content).map(([symbol, data]: [string, any]) => (
                                                    <div key={symbol} className="p-2 rounded bg-slate-900/50">
                                                        <p className="text-xs font-bold text-slate-300 mb-1">{symbol}</p>
                                                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                                                            {data.metrics?.map((metric: any, idx: number) => (
                                                                <div key={idx} className="flex justify-between">
                                                                    <span className="text-slate-500">{metric.label}:</span>
                                                                    <span className="font-mono text-slate-300">
                                                                        {metric.current ?? "N/A"}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </GlassCard>
    );
}