import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  LayoutDashboard,
  ListFilter,
  FileCode2,
  FlaskConical,
  Menu,
  X,
} from 'lucide-react';
import type {
  ActivityEvent,
  FileReport,
  Finding,
  HealthStatus,
  ProjectReport,
  ScanProgress,
  WorkspacePreset,
} from './types';
import { OverviewPanel } from './components/OverviewPanel';
import { FindingsPanel } from './components/FindingsPanel';
import { SourceInspector } from './components/SourceInspector';
import { BenchmarkPanel } from './components/BenchmarkPanel';
import { RuleDrawer } from './components/RuleDrawer';

type ActiveView = 'overview' | 'findings' | 'inspector' | 'benchmark';

const EMPTY_REPORT: ProjectReport = {
  score: 100,
  grade: 'A',
  loc_total: 0,
  counts_by_severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  counts_by_category: {},
  files: [],
  trend: [],
  target_dir: null,
  project_name: 'Loading Workspace...',
};

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('overview');
  const [report, setReport] = useState<ProjectReport>(EMPTY_REPORT);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [presets, setPresets] = useState<WorkspacePreset[]>([]);
  const [selfScanPath, setSelfScanPath] = useState<string>('');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastDelta, setLastDelta] = useState(0);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // Navigation & Drawer states
  const [findingsSeveritySeed, setFindingsSeveritySeed] = useState<string>('all');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [drawerState, setDrawerState] = useState<{ finding: Finding; relPath: string } | null>(null);

  // Workspace switcher states
  const [customDirInput, setCustomDirInput] = useState('');
  const [dirError, setDirError] = useState<string | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const exportRef = useRef<HTMLDivElement | null>(null);

  const fetchFullState = useCallback(async () => {
    try {
      const [repRes, healthRes, actRes, presetRes] = await Promise.all([
        fetch('/api/report'),
        fetch('/api/health'),
        fetch('/api/activity'),
        fetch('/api/presets'),
      ]);

      if (repRes.ok) {
        const repData = (await repRes.json()) as ProjectReport;
        setReport(repData);
        setSelectedFilePath((prev) => {
          if (prev && repData.files.some((f) => f.path === prev)) return prev;
          return repData.files[0]?.path || null;
        });
      }
      if (healthRes.ok) {
        setHealth((await healthRes.json()) as HealthStatus);
      }
      if (actRes.ok) {
        setActivity((await actRes.json()) as ActivityEvent[]);
      }
      if (presetRes.ok) {
        const pData = (await presetRes.json()) as {
          presets: WorkspacePreset[];
          self_scan_path: string;
        };
        setPresets(pData.presets);
        setSelfScanPath(pData.self_scan_path);
      }
    } catch {
      // Initial retry handled on WebSocket reconnect
    }
  }, []);

  useEffect(() => {
    fetchFullState();
  }, [fetchFullState]);

  // Resilient WebSocket connection with automatic reconnect & idempotent event sync
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        if (unmounted) return;
        setWsConnected(true);
        fetchFullState();
        keepAliveInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 20000);
      };

      ws.onmessage = (msgEvent) => {
        try {
          const parsed = JSON.parse(String(msgEvent.data)) as {
            event: string;
            data: Record<string, unknown>;
          };

          if (parsed.event === 'scan_progress') {
            const prog = parsed.data as unknown as ScanProgress;
            setScanProgress(prog.current >= prog.total ? null : prog);
          } else if (parsed.event === 'activity_event') {
            const act = parsed.data as unknown as ActivityEvent;
            setActivity((prev) => {
              if (prev.some((existing) => existing.id === act.id)) return prev;
              return [act, ...prev].slice(0, 50);
            });
          } else if (parsed.event === 'score_update' || parsed.event === 'file_analyzed') {
            if (typeof parsed.data.delta_score === 'number') {
              setLastDelta(parsed.data.delta_score);
            }
            // Refresh authoritative project report
            fetch('/api/report')
              .then((r) => r.json())
              .then((updated: ProjectReport) => {
                if (!unmounted) setReport(updated);
              })
              .catch(() => {});
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (!unmounted) {
          setWsConnected(false);
          reconnectTimer = setTimeout(connect, 1500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      ws?.close();
    };
  }, [fetchFullState]);

  // Close export popover on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleLoadPreset = async (presetId: string) => {
    setSwitchingWorkspace(true);
    setDirError(null);
    try {
      const res = await fetch('/api/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { report: ProjectReport };
        setReport(data.report);
        setSelectedFilePath(data.report.files[0]?.path || null);
        setLastDelta(0);
        await fetchFullState();
        setMobileSidebarOpen(false);
      }
    } finally {
      setSwitchingWorkspace(false);
    }
  };

  const handleWatchCustomDir = async (targetPath: string, customName?: string) => {
    if (!targetPath.trim()) return;
    setSwitchingWorkspace(true);
    setDirError(null);
    try {
      const res = await fetch('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath.trim(), name: customName }),
      });
      const payload = (await res.json()) as { detail?: string; report?: ProjectReport };
      if (!res.ok) {
        setDirError(payload.detail || 'Unable to watch directory.');
        return;
      }
      if (payload.report) {
        setReport(payload.report);
        setSelectedFilePath(payload.report.files[0]?.path || null);
      }
      setLastDelta(0);
      setCustomDirInput('');
      await fetchFullState();
      setMobileSidebarOpen(false);
    } finally {
      setSwitchingWorkspace(false);
    }
  };

  const handleApplyAutoFix = async (finding: Finding) => {
    const res = await fetch('/api/findings/autofix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: finding.file,
        rule_id: finding.rule_id,
        line: finding.line,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { report?: ProjectReport };
      if (data.report) setReport(data.report);
    }
  };

  const handleDismissFinding = async (fingerprint: string, reason: string) => {
    const res = await fetch(`/api/findings/${encodeURIComponent(fingerprint)}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      const data = (await res.json()) as { report?: ProjectReport };
      if (data.report) setReport(data.report);
    }
  };

  const handleRestoreFinding = async (fingerprint: string) => {
    const res = await fetch(`/api/findings/${encodeURIComponent(fingerprint)}/restore`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = (await res.json()) as { report?: ProjectReport };
      if (data.report) setReport(data.report);
    }
  };

  const handleSaveFileContent = async (filePath: string, content: string) => {
    const res = await fetch('/api/files/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (res.ok) {
      const data = (await res.json()) as { report?: ProjectReport };
      if (data.report) setReport(data.report);
    }
  };

  const handleExportReport = async (format: 'json' | 'md') => {
    setExportMenuOpen(false);
    const res = await fetch(`/api/export?format=${format}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = format === 'md' ? 'codepulse_report.md' : 'codepulse_report.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleSelectFileFromTreemap = (file: FileReport) => {
    setSelectedFilePath(file.path);
    setFocusLine(null);
    setActiveView('inspector');
  };

  const handleOpenFileAtLine = (filePath: string, line: number) => {
    setSelectedFilePath(filePath);
    setFocusLine(line);
    setActiveView('inspector');
  };

  const activeIssueTotal = Object.values(report.counts_by_severity).reduce((a, b) => a + b, 0);

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between p-4 gap-6">
      <div className="space-y-6">
        {/* Active Workspace Summary */}
        <div className="space-y-1.5 pb-4 border-b border-slate-800/90">
          <div className="text-xs text-slate-400">Active Workspace</div>
          <div className="text-sm font-semibold text-slate-100 truncate">{report.project_name}</div>
          <div className="text-[11px] font-mono text-slate-500 truncate" title={report.target_dir || ''}>
            {report.target_dir || 'Unmounted'}
          </div>
          <div className="text-[11px] text-slate-400 pt-1">
            <span>{report.files.length} files</span>
            <span className="mx-1.5 text-slate-600">·</span>
            <span>{health?.git_available ? 'Git HEAD diff active' : 'Standalone tree'}</span>
          </div>
        </div>

        {/* Navigation Views */}
        <div className="space-y-1">
          <div className="px-2 pb-1 text-xs font-medium text-slate-500">Analysis Views</div>
          <button
            type="button"
            onClick={() => {
              setActiveView('overview');
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              activeView === 'overview'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>Health Overview</span>
            </span>
            <span className="font-mono tabular-nums">{report.score.toFixed(0)}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setFindingsSeveritySeed('all');
              setActiveView('findings');
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              activeView === 'findings'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <ListFilter className="w-4 h-4 shrink-0" />
              <span>Active Findings</span>
            </span>
            <span className="font-mono tabular-nums">{activeIssueTotal}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView('inspector');
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              activeView === 'inspector'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <FileCode2 className="w-4 h-4 shrink-0" />
              <span>Source Inspector</span>
            </span>
            <span className="font-mono tabular-nums">{report.files.length}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView('benchmark');
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              activeView === 'benchmark'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <FlaskConical className="w-4 h-4 shrink-0" />
              <span>Rule Benchmark</span>
            </span>
          </button>
        </div>

        {/* Bundled Sample Repositories & Self-Scan */}
        <div className="space-y-2 pt-4 border-t border-slate-800/90">
          <div className="px-2 text-xs font-medium text-slate-500">Sample Workspaces</div>
          <div className="space-y-1">
            {presets.map((preset) => {
              const isCurrent = report.project_name === preset.name;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={switchingWorkspace}
                  onClick={() => handleLoadPreset(preset.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-slate-800 text-slate-100 font-medium'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <div className="truncate">{preset.name}</div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{preset.stack}</div>
                </button>
              );
            })}

            {selfScanPath && (
              <button
                type="button"
                disabled={switchingWorkspace}
                onClick={() => handleWatchCustomDir(selfScanPath, 'CodePulse Source (src/)')}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                  report.project_name === 'CodePulse Source (src/)'
                    ? 'bg-slate-800 text-slate-100 font-medium'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <div className="truncate">CodePulse UI Source</div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">Self-scan /src directory</div>
              </button>
            )}
          </div>
        </div>

        {/* Custom Local Folder Path Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleWatchCustomDir(customDirInput);
          }}
          className="space-y-2 pt-4 border-t border-slate-800/90"
        >
          <label htmlFor="custom-dir-input" className="block px-1 text-xs font-medium text-slate-500">
            Watch Local Directory
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="custom-dir-input"
              type="text"
              value={customDirInput}
              onChange={(e) => setCustomDirInput(e.target.value)}
              placeholder="/path/to/repo"
              className="min-w-0 flex-1 px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={switchingWorkspace || !customDirInput.trim()}
              aria-label="Load directory path"
              className="p-1.5 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
          {dirError && <p className="text-[11px] text-red-400 px-1">{dirError}</p>}
        </form>
      </div>

      {/* Real WebSocket Connection Status */}
      <div className="pt-4 border-t border-slate-800/90 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              wsConnected ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          <span>{wsConnected ? 'Live Watcher Active' : 'Reconnecting...'}</span>
        </div>
        <span className="font-mono text-[11px] text-slate-500">100% Local</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Navigation Header */}
      <header className="h-14 px-6 border-b border-slate-800 bg-[#0D131F] flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            aria-label="Toggle workspace navigation"
            className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
          >
            {mobileSidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('overview');
            }}
            className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
          >
            CodePulse
          </a>
        </div>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveView('overview')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'overview' ? 'text-slate-50 underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveView('findings')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'findings' ? 'text-slate-50 underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Findings
          </button>
          <button
            type="button"
            onClick={() => setActiveView('inspector')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'inspector' ? 'text-slate-50 underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Inspector
          </button>
          <button
            type="button"
            onClick={() => setActiveView('benchmark')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'benchmark' ? 'text-slate-50 underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Benchmark
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="relative shrink-0" ref={exportRef}>
          <button
            type="button"
            onClick={() => setExportMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Report</span>
          </button>

          {exportMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-lg border border-slate-700 bg-[#111827] py-1 z-40">
              <button
                type="button"
                onClick={() => handleExportReport('md')}
                className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                Download Markdown (.md)
              </button>
              <button
                type="button"
                onClick={() => handleExportReport('json')}
                className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                Download JSON (.json)
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 bg-[#0D131F]">
          {sidebarContent}
        </aside>

        {/* Mobile Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div className="w-64 bg-[#0D131F] border-r border-slate-800 h-full overflow-y-auto">
              {sidebarContent}
            </div>
            <div
              className="flex-1 bg-black/50"
              onClick={() => setMobileSidebarOpen(false)}
            />
          </div>
        )}

        {/* Primary Content Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8 max-w-[1440px] mx-auto w-full space-y-6">
          {scanProgress && (
            <div className="border border-blue-500/40 rounded-lg bg-blue-950/30 px-4 py-2.5 flex items-center justify-between text-xs font-mono tabular-nums text-blue-200">
              <span>Scanning {scanProgress.file}...</span>
              <span>
                {scanProgress.current} / {scanProgress.total}
              </span>
            </div>
          )}

          {activeView === 'overview' && (
            <OverviewPanel
              report={report}
              lastDelta={lastDelta}
              activity={activity}
              onSelectFile={handleSelectFileFromTreemap}
              onNavigateFindings={(sev) => {
                setFindingsSeveritySeed(sev || 'all');
                setActiveView('findings');
              }}
            />
          )}

          {activeView === 'findings' && (
            <FindingsPanel
              files={report.files}
              initialSeverity={findingsSeveritySeed}
              onInspectFinding={(finding, relPath) => setDrawerState({ finding, relPath })}
              onApplyAutoFix={handleApplyAutoFix}
              onDismissFinding={handleDismissFinding}
              onRestoreFinding={handleRestoreFinding}
              onOpenFileAtLine={handleOpenFileAtLine}
            />
          )}

          {activeView === 'inspector' && (
            <SourceInspector
              files={report.files}
              selectedFilePath={selectedFilePath}
              focusLine={focusLine}
              onSelectFilePath={(p) => {
                setSelectedFilePath(p);
                setFocusLine(null);
              }}
              onSaveFileContent={handleSaveFileContent}
              onApplyAutoFix={handleApplyAutoFix}
              onInspectFinding={(finding, relPath) => setDrawerState({ finding, relPath })}
            />
          )}

          {activeView === 'benchmark' && <BenchmarkPanel />}
        </main>
      </div>

      {/* Remediation Guide Drawer */}
      <RuleDrawer
        finding={drawerState?.finding || null}
        relPath={drawerState?.relPath || ''}
        onClose={() => setDrawerState(null)}
        onApplyAutoFix={handleApplyAutoFix}
        onOpenInEditor={handleOpenFileAtLine}
        onDismiss={handleDismissFinding}
      />
    </div>
  );
}
