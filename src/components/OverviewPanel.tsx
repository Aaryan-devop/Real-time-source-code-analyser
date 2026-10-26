import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, ArrowRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ActivityEvent, FileReport, ProjectReport } from '../types';
import { CodebaseTreemap } from './CodebaseTreemap';

interface OverviewPanelProps {
  report: ProjectReport;
  lastDelta: number;
  activity: ActivityEvent[];
  onSelectFile: (file: FileReport) => void;
  onNavigateFindings: (severity?: string) => void;
}

function gradeColorClass(grade: string): string {
  switch (grade) {
    case 'A':
      return 'text-emerald-400';
    case 'B':
      return 'text-sky-400';
    case 'C':
      return 'text-amber-300';
    case 'D':
      return 'text-orange-400';
    default:
      return 'text-red-400';
  }
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { value?: number; payload?: { timeLabel: string; score: number } }[];
}

function TrendTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) return null;
  const pt = payload[0].payload;
  return (
    <div className="bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs">
      <div className="text-slate-400 font-mono tabular-nums">{pt.timeLabel}</div>
      <div className="text-slate-100 font-semibold font-mono tabular-nums mt-0.5">
        Health Score: {pt.score.toFixed(1)} / 100
      </div>
    </div>
  );
}

export function OverviewPanel({
  report,
  lastDelta,
  activity,
  onSelectFile,
  onNavigateFindings,
}: OverviewPanelProps) {
  const activeIssuesTotal = useMemo(() => {
    return Object.values(report.counts_by_severity).reduce((acc, v) => acc + v, 0);
  }, [report.counts_by_severity]);

  const uncommittedIssuesCount = useMemo(() => {
    return report.files.reduce(
      (acc, f) => acc + f.findings.filter((item) => !item.dismissed && item.is_new).length,
      0
    );
  }, [report.files]);

  const maxComplexity = useMemo(() => {
    return report.files.reduce((max, f) => Math.max(max, f.complexity_max), 0);
  }, [report.files]);

  const avgDurationMs = useMemo(() => {
    if (report.files.length === 0) return 0;
    const sum = report.files.reduce((acc, f) => acc + f.duration_ms, 0);
    return Math.round((sum / report.files.length) * 100) / 100;
  }, [report.files]);

  const chartData = useMemo(() => {
    return report.trend.map((pt, idx) => {
      const d = new Date(pt.timestamp);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return {
        index: idx + 1,
        timeLabel: `${hh}:${mm}:${ss}`,
        score: pt.score,
      };
    });
  }, [report.trend]);

  return (
    <div className="space-y-8">
      {/* Top 4-Column Flat Telemetry Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border border-slate-800 rounded-xl bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
        {/* Metric 1: Health Score & Grade */}
        <div className="p-5 flex flex-col justify-between gap-3">
          <div className="text-xs font-medium text-slate-400">Code Health Score</div>
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-2.5">
              <span className="text-4xl font-bold tracking-tight font-mono tabular-nums text-slate-50">
                {report.score.toFixed(1)}
              </span>
              <span className="text-sm text-slate-500 font-mono">/ 100</span>
            </div>
            <div className="text-right">
              <span className={`text-2xl font-bold font-mono ${gradeColorClass(report.grade)}`}>
                Grade {report.grade}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            {lastDelta !== 0 ? (
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  lastDelta > 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {lastDelta > 0 ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                )}
                {lastDelta > 0 ? `+${lastDelta.toFixed(1)}` : lastDelta.toFixed(1)} pts last edit
              </span>
            ) : (
              <span>LOC-normalized penalty index</span>
            )}
          </div>
        </div>

        {/* Metric 2: Active Findings Breakdown */}
        <div className="p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Active Findings</span>
            <button
              type="button"
              onClick={() => onNavigateFindings()}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>Inspect all</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-50">
              {activeIssuesTotal}
            </span>
            {uncommittedIssuesCount > 0 && (
              <span className="text-xs text-amber-300 font-mono tabular-nums">
                {uncommittedIssuesCount} on uncommitted lines
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums">
            <button
              type="button"
              onClick={() => onNavigateFindings('critical')}
              className="text-red-400 hover:underline cursor-pointer"
            >
              {report.counts_by_severity.critical} Crit
            </button>
            <span className="text-slate-600">·</span>
            <button
              type="button"
              onClick={() => onNavigateFindings('high')}
              className="text-orange-400 hover:underline cursor-pointer"
            >
              {report.counts_by_severity.high} High
            </button>
            <span className="text-slate-600">·</span>
            <button
              type="button"
              onClick={() => onNavigateFindings('medium')}
              className="text-amber-300 hover:underline cursor-pointer"
            >
              {report.counts_by_severity.medium} Med
            </button>
            <span className="text-slate-600">·</span>
            <button
              type="button"
              onClick={() => onNavigateFindings('low')}
              className="text-sky-400 hover:underline cursor-pointer"
            >
              {report.counts_by_severity.low} Low
            </button>
          </div>
        </div>

        {/* Metric 3: Codebase Footprint & Peak Complexity */}
        <div className="p-5 flex flex-col justify-between gap-3">
          <div className="text-xs font-medium text-slate-400">Indexed Footprint</div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-50">
              {report.loc_total.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">lines across {report.files.length} files</span>
          </div>
          <div className="text-xs text-slate-400 font-mono tabular-nums">
            <span>Peak cyclomatic complexity: {maxComplexity}</span>
          </div>
        </div>

        {/* Metric 4: Incremental Analysis Speed */}
        <div className="p-5 flex flex-col justify-between gap-3">
          <div className="text-xs font-medium text-slate-400">Incremental Engine Pass</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-50">
              {avgDurationMs.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-mono">ms / file</span>
          </div>
          <div className="text-xs text-slate-400">
            <span>SHA-256 cached · 300ms debounce</span>
          </div>
        </div>
      </section>

      {/* Middle 2-Column Analytical Split: Health Trendline + Live Incremental Stream */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Cols: Recharts Health Score Trendline */}
        <div className="lg:col-span-7 border border-slate-800 rounded-xl bg-[#111827] p-6 flex flex-col justify-between">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Health Score Trajectory</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Historical commit snapshots and live working-tree edits
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-400">
              {chartData.length} recorded checkpoints
            </div>
          </div>

          <div className="h-56 w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="scoreAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#scoreAreaFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                Save a file or run a workspace scan to record trend checkpoints.
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Cols: Real-Time Watcher & Incremental Event Stream */}
        <div className="lg:col-span-5 border border-slate-800 rounded-xl bg-[#111827] p-6 flex flex-col">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Live Analysis Stream</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time file saves, quick-fixes, and score adjustments
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {activity.length} events
            </span>
          </div>

          <div className="divide-y divide-slate-800/80 overflow-y-auto max-h-56 pr-1">
            {activity.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Waiting for filesystem or workspace events...
              </div>
            ) : (
              activity.slice(0, 10).map((ev) => {
                const timeStr = new Date(ev.timestamp).toLocaleTimeString([], {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <div key={ev.id} className="py-2.5 first:pt-0 last:pb-0 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200 font-medium truncate">{ev.summary}</span>
                      {typeof ev.delta_score === 'number' && ev.delta_score !== 0 && (
                        <span
                          className={`font-mono tabular-nums shrink-0 font-semibold ${
                            ev.delta_score > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {ev.delta_score > 0
                            ? `+${ev.delta_score.toFixed(1)}`
                            : ev.delta_score.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-slate-500 font-mono tabular-nums">
                      <span>{timeStr}</span>
                      <span aria-hidden="true">·</span>
                      <span>{ev.type.replace('_', ' ')}</span>
                      {typeof ev.duration_ms === 'number' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{ev.duration_ms} ms</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Bottom Full-Width Section: Proportional Codebase Risk Treemap */}
      <section className="border border-slate-800 rounded-xl bg-[#111827] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Module Risk Treemap</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Each module cell scales by lines of code and reflects its highest active finding severity
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>Critical</span>
            <span aria-hidden="true">·</span>
            <span>High</span>
            <span aria-hidden="true">·</span>
            <span>Medium</span>
            <span aria-hidden="true">·</span>
            <span>Low</span>
            <span aria-hidden="true">·</span>
            <span>Clean</span>
          </div>
        </div>

        <CodebaseTreemap files={report.files} onSelectFile={onSelectFile} />
      </section>
    </div>
  );
}
