import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Play, AlertTriangle } from 'lucide-react';
import type { BenchmarkSummary } from '../types';

export function BenchmarkPanel() {
  const [summary, setSummary] = useState<BenchmarkSummary | null>(null);
  const [running, setRunning] = useState(false);

  const runSuite = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/eval/run', { method: 'POST' });
      const data = (await res.json()) as BenchmarkSummary;
      setSummary(data);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    runSuite();
  }, [runSuite]);

  return (
    <div className="space-y-6">
      {/* Header & Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-800 rounded-xl bg-[#111827] p-5">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Analyzer Precision, Recall & Redaction Harness
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Executes positive vulnerable fixtures and safe negative controls in-memory to verify zero false positives and mandatory credential redaction
          </p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={runSuite}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{running ? 'Running Fixtures...' : 'Re-Run Evaluation Suite'}</span>
        </button>
      </div>

      {summary && (
        <>
          {/* 4-Column Metric Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border border-slate-800 rounded-xl bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
            <div className="p-5">
              <div className="text-xs text-slate-400">Precision / Recall</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-2">
                {summary.precision.toFixed(1)}% / {summary.recall.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 mt-1">Ground-truth rule matching</div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-400">Harmonic F1 Score</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-50 mt-2">
                {summary.f1_score.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 mt-1">Across {summary.total_cases} labeled suites</div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-400">Secret Redaction Integrity</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-2">
                {summary.secret_redaction_rate.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 mt-1">Zero plaintext secrets persisted</div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-400">Mean Fixture Latency</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-50 mt-2">
                {summary.avg_file_latency_ms.toFixed(2)} ms
              </div>
              <div className="text-xs text-slate-500 mt-1">Target budget &lt; 1000 ms</div>
            </div>
          </div>

          {/* Fixture Breakdown Table */}
          <div className="border border-slate-800 rounded-xl bg-[#111827] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-[#0D131F]">
                    <th className="py-2.5 px-4 whitespace-nowrap">Result</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Analyzer Suite</th>
                    <th className="py-2.5 px-4">Fixture Case</th>
                    <th className="py-2.5 px-4">Detected Rules</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">TP / FP / FN</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {summary.cases.map((c) => {
                    const passed =
                      c.falsePositives === 0 && c.falseNegatives === 0 && c.redactionVerified;
                    return (
                      <tr key={c.name} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          {passed ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Pass</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Mismatch</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">{c.suite}</td>
                        <td className="py-2.5 px-4 text-slate-100 font-medium">{c.name}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {c.detectedRules.length > 0 ? c.detectedRules.join(' · ') : 'None (Clean negative)'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {c.truePositives} / {c.falsePositives} / {c.falseNegatives}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                          {c.durationMs.toFixed(2)} ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
