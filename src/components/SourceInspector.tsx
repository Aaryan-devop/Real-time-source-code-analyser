import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, Wrench } from 'lucide-react';
import type { FileReport, Finding } from '../types';
import { SeverityLabel } from './SeverityLabel';

interface SourceInspectorProps {
  files: FileReport[];
  selectedFilePath: string | null;
  focusLine: number | null;
  onSelectFilePath: (path: string) => void;
  onSaveFileContent: (path: string, content: string) => Promise<void>;
  onApplyAutoFix: (finding: Finding) => Promise<void>;
  onInspectFinding: (finding: Finding, relPath: string) => void;
}

export function SourceInspector({
  files,
  selectedFilePath,
  focusLine,
  onSelectFilePath,
  onSaveFileContent,
  onApplyAutoFix,
  onInspectFinding,
}: SourceInspectorProps) {
  const activeFile = useMemo(() => {
    if (files.length === 0) return null;
    return files.find((f) => f.path === selectedFilePath) || files[0];
  }, [files, selectedFilePath]);

  const [mode, setMode] = useState<'annotated' | 'edit'>('annotated');
  const [sourceText, setSourceText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const loadContent = useCallback(async (filePath: string) => {
    setLoadingFile(true);
    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error('Failed to load file');
      const data = (await res.json()) as { content: string };
      setSourceText(data.content);
      setOriginalText(data.content);
    } catch {
      setSourceText('# Unable to read file from disk.');
      setOriginalText('');
    } finally {
      setLoadingFile(false);
    }
  }, []);

  useEffect(() => {
    if (activeFile?.path) {
      loadContent(activeFile.path);
    }
  }, [activeFile?.path, activeFile?.analyzed_at, loadContent]);

  const isDirty = sourceText !== originalText;

  const handleSave = useCallback(async () => {
    if (!activeFile || saving) return;
    setSaving(true);
    setSaveFeedback(null);
    try {
      await onSaveFileContent(activeFile.path, sourceText);
      setOriginalText(sourceText);
      setSaveFeedback('Saved & re-analyzed');
      setTimeout(() => setSaveFeedback(null), 2500);
    } finally {
      setSaving(false);
    }
  }, [activeFile, onSaveFileContent, saving, sourceText]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  // Scroll focused line into view
  const focusRef = React.useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (focusLine && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusLine, sourceText]);

  const findingsByLine = useMemo(() => {
    const map = new Map<number, Finding[]>();
    if (!activeFile) return map;
    for (const f of activeFile.findings) {
      if (f.dismissed) continue;
      const list = map.get(f.line) || [];
      list.push(f);
      map.set(f.line, list);
    }
    return map;
  }, [activeFile]);

  const lines = useMemo(() => sourceText.split(/\r?\n/), [sourceText]);

  if (!activeFile) {
    return (
      <div className="border border-slate-800 rounded-xl bg-[#111827] py-16 text-center text-sm text-slate-400">
        No indexed workspace files available.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 3 Cols: Workspace File Explorer */}
      <aside className="lg:col-span-3 border border-slate-800 rounded-xl bg-[#111827] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Workspace Modules</span>
          <span className="text-xs font-mono tabular-nums text-slate-500">{files.length}</span>
        </div>
        <div className="divide-y divide-slate-800/70 max-h-[600px] overflow-y-auto">
          {files.map((file) => {
            const activeCount = file.findings.filter((f) => !f.dismissed).length;
            const isSelected = file.path === activeFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelectFilePath(file.path)}
                className={`w-full px-4 py-2.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  isSelected ? 'bg-blue-600/15 text-slate-50' : 'text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono truncate">{file.rel_path}</div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                    {file.loc} LOC · {file.duration_ms} ms
                  </div>
                </div>
                <span
                  className={`text-xs font-mono tabular-nums shrink-0 ${
                    activeCount > 0 ? 'text-amber-300 font-semibold' : 'text-emerald-400'
                  }`}
                >
                  {activeCount > 0 ? activeCount : 'OK'}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right 9 Cols: Annotated Source Viewer & Live Disk Editor */}
      <div className="lg:col-span-9 border border-slate-800 rounded-xl bg-[#111827] overflow-hidden">
        {/* Editor Toolbar */}
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#0D131F]">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
            <span className="font-semibold text-slate-100">{activeFile.rel_path}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">{activeFile.language}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">{lines.length} lines</span>
            {activeFile.complexity_max > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400">Max CC {activeFile.complexity_max}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {saveFeedback && (
              <span className="text-xs text-emerald-400 font-mono">{saveFeedback}</span>
            )}

            <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('annotated')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'annotated' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Annotated View
              </button>
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'edit' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Edit Source
              </button>
            </div>

            {mode === 'edit' && (
              <button
                type="button"
                disabled={saving || !isDirty}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Analyzing...' : 'Save & Analyze (⌘S)'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Source Content Body */}
        {loadingFile ? (
          <div className="py-20 text-center text-xs text-slate-500">Reading source file...</div>
        ) : mode === 'edit' ? (
          <div className="p-4 space-y-2 bg-[#0B0F17]">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                Edit file contents directly and press Save & Analyze (or Ctrl/⌘+S) to trigger live incremental analysis.
              </span>
              {isDirty && <span className="text-amber-300 font-mono">Unsaved edits</span>}
            </div>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              spellCheck={false}
              rows={24}
              className="code-editor w-full p-4 text-xs leading-relaxed bg-[#080B11] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>
        ) : (
          <div className="overflow-x-auto bg-[#0B0F17] max-h-[620px] overflow-y-auto">
            <table className="w-full border-collapse font-mono text-xs">
              <tbody>
                {lines.map((lineText, idx) => {
                  const lineNo = idx + 1;
                  const lineFindings = findingsByLine.get(lineNo) || [];
                  const hasFinding = lineFindings.length > 0;
                  const isFocused = focusLine === lineNo;

                  return (
                    <React.Fragment key={lineNo}>
                      <tr
                        ref={isFocused ? focusRef : undefined}
                        className={`${
                          hasFinding
                            ? 'bg-red-950/30'
                            : isFocused
                              ? 'bg-blue-950/30'
                              : 'hover:bg-slate-900/60'
                        }`}
                      >
                        <td className="w-12 py-1 px-3 text-right select-none text-slate-600 tabular-nums border-r border-slate-800/80 align-top">
                          {lineNo}
                        </td>
                        <td className="py-1 px-4 whitespace-pre text-slate-200 align-top">
                          {lineText || ' '}
                        </td>
                      </tr>

                      {lineFindings.map((f) => (
                        <tr key={f.id} className="bg-[#131B2E] border-y border-slate-800">
                          <td className="py-2 px-3 text-right text-slate-500 select-none border-r border-slate-800/80">
                            ↳
                          </td>
                          <td className="py-2.5 px-4 font-sans">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="space-y-0.5">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <SeverityLabel severity={f.severity} />
                                  <span className="text-slate-600">·</span>
                                  <span className="font-mono text-slate-300">{f.rule_id}</span>
                                  {f.is_new && (
                                    <>
                                      <span className="text-slate-600">·</span>
                                      <span className="text-amber-300">Uncommitted git change</span>
                                    </>
                                  )}
                                  <span className="text-slate-600">·</span>
                                  <span className="font-semibold text-slate-100">{f.title}</span>
                                </div>
                                <p className="text-xs text-slate-400">{f.suggested_fix}</p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => onInspectFinding(f, activeFile.rel_path)}
                                  className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                                >
                                  Remediation Guide
                                </button>
                                {f.can_autofix && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await onApplyAutoFix(f);
                                      await loadContent(activeFile.path);
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap"
                                  >
                                    <Wrench className="w-3 h-3" />
                                    <span>Apply Fix</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
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
