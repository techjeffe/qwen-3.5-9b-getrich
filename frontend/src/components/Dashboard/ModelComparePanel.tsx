"use client";

import GlassCard from "./GlassCard";
import { AnalysisResult, AnalysisSnapshotItem } from "@/lib/types/analysis";
import { ComparisonResultsCard, StageMetricsComparison } from "@/lib/utils/comparison";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, Target } from "lucide-react";
import { useMemo, useState } from "react";

interface ModelComparePanelProps {
    result: AnalysisResult | null;
    snapshots: AnalysisSnapshotItem[];
    availableModels: string[];
    compareBaselineResult: AnalysisResult | null;
    compareResult: AnalysisResult | null;
    goldenDatasetRequestId: string;
    goldenBaselineResult: AnalysisResult | null;
    benchmarkResults: AnalysisResult[];
    savedBaselineResult: AnalysisResult | null;
    savedComparisonResult: AnalysisResult | null;
    onRerunSnapshot: (requestId: string, modelName: string, extractionModel?: string, reasoningModel?: string) => void;
    onCompareSavedRuns: (baselineRequestId: string, comparisonRequestId: string) => void;
    onSelectGoldenDataset: (requestId: string) => void;
    onClearBenchmarks: () => void;
    rerunLoading: boolean;
    rerunError: string | null;
    savedCompareLoading: boolean;
    savedCompareError: string | null;
}

export default function ModelComparePanel({
    result,
    snapshots,
    availableModels,
    compareBaselineResult,
    compareResult,
    goldenDatasetRequestId,
    goldenBaselineResult,
    benchmarkResults,
    savedBaselineResult,
    savedComparisonResult,
    onRerunSnapshot,
    onCompareSavedRuns,
    onSelectGoldenDataset,
    onClearBenchmarks,
    rerunLoading,
    rerunError,
    savedCompareLoading,
    savedCompareError,
}: ModelComparePanelProps) {
    const [selectedModel, setSelectedModel] = useState("");
    const [selectedBaseline, setSelectedBaseline] = useState("");
    const [selectedComparison, setSelectedComparison] = useState("");

    const availableModelsList = useMemo(() => {
        const models = new Set<string>(availableModels);
        snapshots.forEach((s) => {
            if (s.extraction_model) models.add(s.extraction_model);
            if (s.reasoning_model) models.add(s.reasoning_model);
        });
        return Array.from(models).sort();
    }, [availableModels, snapshots]);

    const snapshotPairs = useMemo(() => {
        const pairs: { id: string; baseline: AnalysisSnapshotItem; comparison: AnalysisSnapshotItem }[] = [];
        for (let i = 0; i < snapshots.length; i++) {
            for (let j = i + 1; j < snapshots.length; j++) {
                pairs.push({
                    id: `${snapshots[i].request_id}_${snapshots[j].request_id}`,
                    baseline: snapshots[i],
                    comparison: snapshots[j],
                });
            }
        }
        return pairs.slice(0, 10);
    }, [snapshots]);

    return (
        <div className="space-y-6">
            {/* Golden Dataset Comparison */}
            {goldenDatasetRequestId && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <GlassCard>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-slate-300">Golden Dataset Comparison</h2>
                            {goldenBaselineResult && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                    {goldenDatasetRequestId.slice(0, 8)}
                                </span>
                            )}
                        </div>

                        {goldenBaselineResult && (
                            <>
                                <StageMetricsComparison baseline={goldenBaselineResult} comparison={result ?? undefined} />
                                <ComparisonResultsCard
                                    title="Golden Dataset"
                                    baselineResult={goldenBaselineResult}
                                    comparisonResult={result}
                                    baselineLabel="Golden Baseline"
                                    comparisonLabel="Current Run"
                                />
                            </>
                        )}

                        {/* Benchmark results */}
                        {benchmarkResults.length > 0 && (
                            <div className="mt-4">
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Benchmark Results ({benchmarkResults.length})</p>
                                    <button
                                        type="button"
                                        onClick={onClearBenchmarks}
                                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {benchmarkResults.map((benchmark) => (
                                        <div
                                            key={benchmark.request_id}
                                            className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3"
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-mono text-slate-300">{benchmark.request_id.slice(0, 8)}...</span>
                                                <span className="text-[10px] text-slate-500">{benchmark.model_inputs ? `${benchmark.model_inputs.articles?.length ?? 0} articles` : "No data"}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold ${
                                                    benchmark.trading_signal?.signal_type === "LONG" ? "text-emerald-400" :
                                                    benchmark.trading_signal?.signal_type === "SHORT" ? "text-red-400" :
                                                    "text-slate-400"
                                                }`}>
                                                    {benchmark.trading_signal?.signal_type || "HOLD"}
                                                </span>
                                                <span className="text-xs text-slate-500">
                                                    {benchmark.trading_signal?.confidence_score ? `${Math.round(benchmark.trading_signal.confidence_score * 100)}%` : "N/A"}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Rerun controls */}
                        <div className="mt-4 pt-4 border-t border-slate-700/40">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Rerun with Different Model</p>
                            <div className="flex flex-wrap gap-2">
                                {availableModelsList.map((model) => (
                                    <button
                                        key={model}
                                        type="button"
                                        onClick={() => setSelectedModel(model)}
                                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                                            selectedModel === model
                                                ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                                                : "border-slate-700/40 bg-slate-800/30 text-slate-400 hover:bg-slate-800/50"
                                        }`}
                                    >
                                        {model}
                                    </button>
                                ))}
                                {selectedModel && (
                                    <button
                                        type="button"
                                        onClick={() => onRerunSnapshot(goldenDatasetRequestId, selectedModel)}
                                        disabled={rerunLoading}
                                        className="flex items-center gap-2 text-xs px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {rerunLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                        Rerun
                                    </button>
                                )}
                            </div>
                            {rerunError && (
                                <p className="text-xs text-red-400 mt-2">{rerunError}</p>
                            )}
                            {compareResult && compareBaselineResult && (
                                <div className="mt-4">
                                    <StageMetricsComparison baseline={compareBaselineResult} comparison={compareResult} />
                                    <ComparisonResultsCard
                                        title="Model Comparison"
                                        baselineResult={compareBaselineResult}
                                        comparisonResult={compareResult}
                                        baselineLabel="Original"
                                        comparisonLabel={selectedModel}
                                    />
                                </div>
                            )}
                        </div>
                    </GlassCard>
                </motion.div>
            )}

            {/* Saved Run Comparison */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <GlassCard>
                    <h2 className="text-sm font-semibold text-slate-300 mb-4">Compare Saved Runs</h2>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Baseline</label>
                            <select
                                value={selectedBaseline}
                                onChange={(e) => setSelectedBaseline(e.target.value)}
                                className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-xs font-mono text-white focus:border-blue-500/50 focus:outline-none"
                            >
                                <option value="">Select baseline...</option>
                                {snapshots.filter((s) => s.snapshot_available).map((s) => (
                                    <option key={s.request_id} value={s.request_id}>
                                        {s.request_id.slice(0, 8)} - {s.model_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Comparison</label>
                            <select
                                value={selectedComparison}
                                onChange={(e) => setSelectedComparison(e.target.value)}
                                className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-xs font-mono text-white focus:border-blue-500/50 focus:outline-none"
                            >
                                <option value="">Select comparison...</option>
                                {snapshots.filter((s) => s.snapshot_available).filter((s) => s.request_id !== selectedBaseline).map((s) => (
                                    <option key={s.request_id} value={s.request_id}>
                                        {s.request_id.slice(0, 8)} - {s.model_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {selectedBaseline && selectedComparison && (
                        <button
                            type="button"
                            onClick={() => onCompareSavedRuns(selectedBaseline, selectedComparison)}
                            disabled={savedCompareLoading}
                            className="flex items-center gap-2 text-xs px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 mb-4"
                        >
                            {savedCompareLoading ? <Loader2 size={12} className="animate-spin" /> : <Target size={12} />}
                            Compare
                        </button>
                    )}

                    {savedCompareError && (
                        <p className="text-xs text-red-400 mb-4">{savedCompareError}</p>
                    )}

                    {savedBaselineResult && savedComparisonResult && (
                        <div>
                            <StageMetricsComparison baseline={savedBaselineResult} comparison={savedComparisonResult} />
                            <ComparisonResultsCard
                                title="Saved Run Comparison"
                                baselineResult={savedBaselineResult}
                                comparisonResult={savedComparisonResult}
                                baselineLabel={selectedBaseline.slice(0, 8)}
                                comparisonLabel={selectedComparison.slice(0, 8)}
                            />
                        </div>
                    )}
                </GlassCard>
            </motion.div>
        </div>
    );
}