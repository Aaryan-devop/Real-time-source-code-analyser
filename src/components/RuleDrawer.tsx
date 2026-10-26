import React, { useEffect, useState } from 'react';
import { Code2, Wrench, X } from 'lucide-react';
import type { Finding, RuleGuide } from '../types';
import { SeverityLabel } from './SeverityLabel';

interface RuleDrawerProps {
  finding: Finding | null;
  relPath: string;
  onClose: () => void;
  onApplyAutoFix: (finding: Finding) => Promise<void>;
  onOpenInEditor: (filePath: string, line: number) => void;
  onDismiss: (fingerprint: string, reason: string) => Promise<void>;
}

export function RuleDrawer({
  finding,
  relPath,
  onClose,
  onApplyAutoFix,
  onOpenInEditor,
  onDismiss,
}: RuleDrawerProps) {
  const [guide, setGuide] = useState<RuleGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!finding) {
      setGuide(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/explain/${encodeURIComponent(finding.rule_id)}`)
      .then((r) => r.json())
      .then((data: RuleGuide) => {
        if (!cancelled) setGuide(data);
      })
      .catch(() => {
        if (!cancelled) setGuide(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [finding]);

  // Close on Escape key
  useEffect(() => {
    if (!finding) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [finding, onClose]);

  if (!finding) return null;

  const handleAutoFix = async () => {
    setApplying(true);
    try {
      await onApplyAutoFix(finding);
      onClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="w-full max-w-xl bg-[#0D131F] border-l border-slate-800 h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-xs text-slate-400 font-mono tabular-nums">
            <SeverityLabel severity={finding.severity} />
            <span aria-hidden="true">·</span>
            <span>{finding.rule_id}</span>
            {guide?.cwe && (
              <>
                <span aria-hidden="true">·</span>
                <span>{guide.cwe}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{relPath}:{finding.line}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close remediation panel"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">{finding.title}</h2>
            <p className="text-slate-300 mt-1.5 leading-relaxed">{finding.message}</p>
          </div>

          {finding.snippet && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-400">Flagged Source Snippet</div>
              <pre className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs text-slate-200 overflow-x-auto">
                {finding.snippet}
              </pre>
            </div>
          )}

          <div className="space-y-4 pt-4 border-t border-slate-800/80">
            <div>
              <h3 className="text-xs font-semibold text-slate-300">Why It Matters</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{finding.why_it_matters}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-300">Recommended Remediation</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{finding.suggested_fix}</p>
            </div>
          </div>

          {loading ? (
            <div className="py-6 text-xs text-slate-500">Loading rule reference pattern...</div>
          ) : (
            guide && (
              <div className="space-y-4 pt-4 border-t border-slate-800/80">
                <div>
                  <h3 className="text-xs font-semibold text-slate-300">{guide.summary}</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{guide.risk_detail}</p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <div className="text-xs text-red-400 mb-1">Vulnerable / Anti-Pattern</div>
                    <pre className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs text-slate-300 overflow-x-auto">
                      {guide.vulnerable_example}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs text-emerald-400 mb-1">Hardened Reference Pattern</div>
                    <pre className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs text-slate-200 overflow-x-auto">
                      {guide.secure_example}
                    </pre>
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  <span>Fingerprint: </span>
                  <span className="font-mono">{finding.fingerprint}</span>
                  {guide.references.length > 0 && (
                    <>
                      <span className="mx-2">·</span>
                      <span>{guide.references[0]}</span>
                    </>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#111827]">
          <button
            type="button"
            onClick={() => {
              onDismiss(finding.fingerprint, 'Reviewed via remediation drawer');
              onClose();
            }}
            className="px-3.5 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            Dismiss Finding
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                onOpenInEditor(finding.file, finding.line);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Edit in Inspector</span>
            </button>

            {finding.can_autofix && !finding.dismissed && (
              <button
                type="button"
                disabled={applying}
                onClick={handleAutoFix}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>{applying ? 'Applying...' : 'Apply Fix to File'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
