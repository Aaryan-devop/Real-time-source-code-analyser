import React, { useMemo, useState } from 'react';
import { Check, RotateCcw, Search, Wrench } from 'lucide-react';
import type { Category, FileReport, Finding, Severity } from '../types';
import { SeverityLabel } from './SeverityLabel';

interface FindingsPanelProps {
  files: FileReport[];
  initialSeverity?: string;
  onInspectFinding: (finding: Finding, relPath: string) => void;
  onApplyAutoFix: (finding: Finding) => Promise<void>;
  onDismissFinding: (fingerprint: string, reason: string) => Promise<void>;
  onRestoreFinding: (fingerprint: string) => Promise<void>;
  onOpenFileAtLine: (filePath: string, line: number) => void;
}

const SEVERITY_TABS: readonly { value: 'all' | Severity; label: string }[] = [
  { value: 'all', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
];

const CATEGORY_TABS: readonly { value: 'all' | Category; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'security', label: 'Security' },
  { value: 'complexity', label: 'Complexity' },
  { value: 'smell', label: 'Smell' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'dependency', label: 'Dependency' },
];

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function FindingsPanel({
  files,
  initialSeverity = 'all',
  onInspectFinding,
  onApplyAutoFix,
  onDismissFinding,
  onRestoreFinding,
  onOpenFileAtLine,
}: FindingsPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>(
    (initialSeverity as 'all' | Severity) || 'all'
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyNewGit, setOnlyNewGit] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissingFp, setDismissingFp] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('Accepted risk after code review');
  const [busyFp, setBusyFp] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialSeverity) {
      setSeverityFilter(initialSeverity as 'all' | Severity);
    }
  }, [initialSeverity]);

  const enrichedFindings = useMemo(() => {
    const rows: { finding: Finding; relPath: string }[] = [];
    for (const file of files) {
      for (const f of file.findings) {
        rows.push({ finding: f, relPath: file.rel_path });
      }
    }

    const q = searchQuery.trim().toLowerCase();

    return rows
      .filter(({ finding, relPath }) => {
        if (!showDismissed && finding.dismissed) return false;
        if (severityFilter !== 'all' && finding.severity !== severityFilter) return false;
        if (categoryFilter !== 'all' && finding.category !== categoryFilter) return false;
        if (onlyNewGit && !finding.is_new) return false;
        if (q) {
          const hay = `${finding.rule_id} ${finding.title} ${finding.message} ${relPath} ${finding.snippet}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.finding.dismissed !== b.finding.dismissed) {
          return a.finding.dismissed ? 1 : -1;
        }
        const sevDiff = SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity];
        if (sevDiff !== 0) return sevDiff;
        if (a.relPath !== b.relPath) return a.relPath.localeCompare(b.relPath);
        return a.finding.line - b.finding.line;
      });
  }, [files, severityFilter, categoryFilter, searchQuery, onlyNewGit, showDismissed]);

  const handleAutoFixClick = async (f: Finding) => {
    setBusyFp(f.fingerprint);
    try {
      await onApplyAutoFix(f);
    } finally {
      setBusyFp(null);
    }
  };

  const submitDismiss = async (fp: string) => {
    setBusyFp(fp);
    try {
      await onDismissFinding(fp, dismissReason);
      setDismissingFp(null);
    } finally {
      setBusyFp(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="border border-slate-800 rounded-xl bg-[#111827] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Interactive Segmented Severity Filter */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
            {SEVERITY_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSeverityFilter(tab.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  severityFilter === tab.value
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input & Toggle Switches */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter rule, file, or snippet..."
                className="pl-8 pr-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 w-56"
              />
            </div>

            <button
              type="button"
              onClick={() => setOnlyNewGit((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                onlyNewGit
                  ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                  : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Uncommitted Lines Only
            </button>

            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showDismissed
                  ? 'bg-slate-800 border-slate-600 text-slate-200'
                  : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Include Dismissed
            </button>
          </div>
        </div>

        {/* Interactive Segmented Category Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-1">
            {CATEGORY_TABS.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategoryFilter(cat.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  categoryFilter === cat.value
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-400 font-mono tabular-nums">
            Showing {enrichedFindings.length} {enrichedFindings.length === 1 ? 'finding' : 'findings'}
          </div>
        </div>
      </div>

      {/* High-Density Findings Data Grid */}
      <div className="border border-slate-800 rounded-xl bg-[#111827] overflow-hidden">
        {enrichedFindings.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-2">
            <p className="text-sm font-medium text-slate-200">No matching findings in active view</p>
            <p className="text-xs text-slate-400">
              Adjust severity or category filters above, or inspect clean modules in the Source Inspector.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0D131F]">
                  <th className="py-2.5 px-4 whitespace-nowrap">Severity</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Rule & Category</th>
                  <th className="py-2.5 px-4">Finding & Code Context</th>
                  <th className="py-2.5 px-4 whitespace-nowrap text-right">Location</th>
                  <th className="py-2.5 px-4 whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {enrichedFindings.map(({ finding, relPath }) => {
                  const isDismissing = dismissingFp === finding.fingerprint;
                  const isBusy = busyFp === finding.fingerprint;

                  return (
                    <React.Fragment key={`${finding.file}:${finding.id}:${finding.line}`}>
                      <tr
                        className={`hover:bg-slate-800/40 transition-colors ${
                          finding.dismissed ? 'opacity-55' : ''
                        }`}
                      >
                        <td className="py-2.5 px-4 align-top whitespace-nowrap">
                          <SeverityLabel severity={finding.severity} />
                        </td>

                        <td className="py-2.5 px-4 align-top whitespace-nowrap">
                          <div className="font-mono text-slate-200">{finding.rule_id}</div>
                          <div className="text-slate-400 mt-0.5 capitalize">
                            <span>{finding.category}</span>
                            {finding.is_new && (
                              <>
                                <span className="mx-1.5 text-slate-600">·</span>
                                <span className="text-amber-300">Uncommitted diff</span>
                              </>
                            )}
                            {finding.dismissed && (
                              <>
                                <span className="mx-1.5 text-slate-600">·</span>
                                <span className="text-slate-400">Dismissed</span>
                              </>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-4 align-top max-w-xl">
                          <button
                            type="button"
                            onClick={() => onInspectFinding(finding, relPath)}
                            className="font-semibold text-slate-100 hover:text-blue-400 transition-colors text-left cursor-pointer"
                          >
                            {finding.title}
                          </button>
                          <p className="text-slate-400 mt-0.5 line-clamp-2">{finding.message}</p>
                          {finding.snippet && (
                            <pre className="mt-1.5 px-2.5 py-1.5 rounded bg-[#0B0F17] border border-slate-800/90 text-[11px] text-slate-300 overflow-x-auto max-w-lg">
                              {finding.snippet}
                            </pre>
                          )}
                        </td>

                        <td className="py-2.5 px-4 align-top text-right whitespace-nowrap font-mono tabular-nums">
                          <button
                            type="button"
                            onClick={() => onOpenFileAtLine(finding.file, finding.line)}
                            className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                          >
                            {relPath}:{finding.line}
                          </button>
                        </td>

                        <td className="py-2.5 px-4 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => onInspectFinding(finding, relPath)}
                              className="px-2.5 py-1 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                            >
                              Guide
                            </button>

                            {!finding.dismissed && finding.can_autofix && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleAutoFixClick(finding)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                              >
                                <Wrench className="w-3 h-3" />
                                <span>Fix</span>
                              </button>
                            )}

                            {finding.dismissed ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => onRestoreFinding(finding.fingerprint)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Restore</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setDismissingFp(isDismissing ? null : finding.fingerprint)
                                }
                                className="px-2.5 py-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                              >
                                Dismiss
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isDismissing && (
                        <tr className="bg-[#0D131F]">
                          <td colSpan={5} className="px-4 py-2.5">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className="text-slate-400">Dismissal reason (persisted by fingerprint):</span>
                              <input
                                type="text"
                                value={dismissReason}
                                onChange={(e) => setDismissReason(e.target.value)}
                                className="px-2.5 py-1 text-xs bg-[#0B0F17] border border-slate-700 rounded-md text-slate-100 w-64 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => submitDismiss(finding.fingerprint)}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-slate-200 text-slate-900 font-medium hover:bg-white cursor-pointer whitespace-nowrap"
                              >
                                <Check className="w-3 h-3" />
                                <span>Confirm</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDismissingFp(null)}
                                className="px-2.5 py-1 rounded-md text-slate-400 hover:text-slate-200 cursor-pointer whitespace-nowrap"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
