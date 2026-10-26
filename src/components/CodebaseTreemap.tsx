import React, { useMemo, useState } from 'react';
import type { FileReport, Severity } from '../types';

interface CodebaseTreemapProps {
  files: FileReport[];
  onSelectFile: (file: FileReport) => void;
}

interface LayoutRect {
  file: FileReport;
  x: number;
  y: number;
  w: number;
  h: number;
  worstSeverity: Severity | 'clean';
  activeCount: number;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const CELL_COLORS: Record<Severity | 'clean', { fill: string; stroke: string; label: string }> = {
  critical: { fill: '#451219', stroke: '#dc2626', label: 'Critical risk' },
  high: { fill: '#431d0c', stroke: '#ea580c', label: 'High risk' },
  medium: { fill: '#3b2d0c', stroke: '#ca8a04', label: 'Medium risk' },
  low: { fill: '#0f2942', stroke: '#0284c7', label: 'Low risk' },
  info: { fill: '#1e293b', stroke: '#475569', label: 'Info note' },
  clean: { fill: '#0b291e', stroke: '#16a34a', label: 'Clean' },
};

function getWorstSeverity(file: FileReport): { worst: Severity | 'clean'; count: number } {
  const active = file.findings.filter((f) => !f.dismissed);
  if (active.length === 0) return { worst: 'clean', count: 0 };
  let best: Severity = 'info';
  let bestRank = 0;
  for (const f of active) {
    const r = SEVERITY_RANK[f.severity] || 0;
    if (r > bestRank) {
      bestRank = r;
      best = f.severity;
    }
  }
  return { worst: best, count: active.length };
}

function computeSliceAndDice(
  items: { file: FileReport; weight: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  horizontal: boolean
): LayoutRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    const { worst, count } = getWorstSeverity(items[0].file);
    return [
      {
        file: items[0].file,
        x,
        y,
        w: Math.max(0, w),
        h: Math.max(0, h),
        worstSeverity: worst,
        activeCount: count,
      },
    ];
  }

  const total = items.reduce((acc, it) => acc + it.weight, 0);
  let accum = 0;
  let splitIdx = 1;
  for (let i = 0; i < items.length - 1; i++) {
    accum += items[i].weight;
    splitIdx = i + 1;
    if (accum >= total / 2) break;
  }

  const leftItems = items.slice(0, splitIdx);
  const rightItems = items.slice(splitIdx);
  const leftRatio = total > 0 ? leftItems.reduce((a, b) => a + b.weight, 0) / total : 0.5;
  const gap = 6;

  if (horizontal) {
    const leftW = Math.max(24, (w - gap) * leftRatio);
    const rightW = Math.max(24, w - gap - leftW);
    return [
      ...computeSliceAndDice(leftItems, x, y, leftW, h, !horizontal),
      ...computeSliceAndDice(rightItems, x + leftW + gap, y, rightW, h, !horizontal),
    ];
  } else {
    const topH = Math.max(24, (h - gap) * leftRatio);
    const botH = Math.max(24, h - gap - topH);
    return [
      ...computeSliceAndDice(leftItems, x, y, w, topH, !horizontal),
      ...computeSliceAndDice(rightItems, x, y + topH + gap, w, botH, !horizontal),
    ];
  }
}

export function CodebaseTreemap({ files, onSelectFile }: CodebaseTreemapProps) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const rects = useMemo(() => {
    const weighted = [...files]
      .map((file) => ({
        file,
        weight: Math.max(file.loc, 10),
      }))
      .sort((a, b) => b.weight - a.weight);

    return computeSliceAndDice(weighted, 0, 0, 960, 270, true);
  }, [files]);

  const hoveredRect = rects.find((r) => r.file.path === hoveredPath) || rects[0] || null;

  if (files.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-400">
        No indexed source files in current workspace. Select a workspace preset or folder to inspect risk distribution.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span>Area proportional to LOC</span>
          <span aria-hidden="true">·</span>
          <span>Click any module cell to open in Source Inspector</span>
        </div>
        {hoveredRect && (
          <div className="font-mono tabular-nums text-slate-300">
            <span>{hoveredRect.file.rel_path}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{hoveredRect.file.loc} LOC</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{hoveredRect.activeCount} issues</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{CELL_COLORS[hoveredRect.worstSeverity].label}</span>
          </div>
        )}
      </div>

      <svg
        viewBox="0 0 960 270"
        className="w-full h-auto block select-none rounded-lg"
        role="img"
        aria-label="Codebase file risk treemap sized by lines of code"
      >
        {rects.map((r) => {
          const palette = CELL_COLORS[r.worstSeverity];
          const isHovered = r.file.path === hoveredPath;
          const showTitle = r.w > 78 && r.h > 36;
          const showMeta = r.w > 110 && r.h > 58;
          const maxChars = Math.max(6, Math.floor((r.w - 20) / 7.2));
          const displayPath =
            r.file.rel_path.length > maxChars
              ? `…${r.file.rel_path.slice(-(maxChars - 1))}`
              : r.file.rel_path;

          return (
            <g
              key={r.file.path}
              className="cursor-pointer transition-opacity duration-150"
              onClick={() => onSelectFile(r.file)}
              onMouseEnter={() => setHoveredPath(r.file.path)}
              onMouseLeave={() => setHoveredPath(null)}
            >
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={6}
                fill={palette.fill}
                stroke={isHovered ? '#f8fafc' : palette.stroke}
                strokeWidth={isHovered ? 2 : 1.2}
              />
              {showTitle && (
                <text
                  x={r.x + 10}
                  y={r.y + 22}
                  fill="#f8fafc"
                  fontSize="12"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {displayPath}
                </text>
              )}
              {showMeta && (
                <text
                  x={r.x + 10}
                  y={r.y + 41}
                  fill="#cbd5e1"
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {`${r.file.loc} LOC · ${r.activeCount} ${r.activeCount === 1 ? 'issue' : 'issues'}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
