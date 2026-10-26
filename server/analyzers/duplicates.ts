import crypto from 'node:crypto';
import path from 'node:path';
import { computeFingerprint } from '../models.ts';
import type { Finding } from '../models.ts';
import type { BaseAnalyzer } from './base.ts';

const MIN_DUPLICATE_LINES = 6;

interface BlockLocation {
  file: string;
  startLine: number;
  endLine: number;
}

function normalizeCodeLine(line: string): string {
  const noComments = line.replace(/(\/\/.*$|#.*$)/, '').trim();
  return noComments.replace(/\s+/g, ' ');
}

export class DuplicateDetector implements BaseAnalyzer {
  readonly name = 'DuplicateDetector';
  private blockIndex = new Map<string, BlockLocation[]>();
  private fileHashes = new Map<string, Set<string>>();

  supports(language: string, filePath: string): boolean {
    return (
      language === 'python' ||
      language === 'javascript' ||
      language === 'typescript' ||
      /\.(?:py|js|jsx|ts|tsx)$/i.test(filePath)
    );
  }

  clear(): void {
    this.blockIndex.clear();
    this.fileHashes.clear();
  }

  removeFile(filePath: string): void {
    const hashes = this.fileHashes.get(filePath);
    if (!hashes) return;
    for (const h of hashes) {
      const locs = this.blockIndex.get(h);
      if (locs) {
        const filtered = locs.filter((entry) => entry.file !== filePath);
        if (filtered.length === 0) {
          this.blockIndex.delete(h);
        } else {
          this.blockIndex.set(h, filtered);
        }
      }
    }
    this.fileHashes.delete(filePath);
  }

  analyze(filePath: string, source: string): Finding[] {
    this.removeFile(filePath);

    const lines = source.split(/\r?\n/);
    const nonEmpty: { lineNo: number; norm: string }[] = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const norm = normalizeCodeLine(lines[idx]);
      // Skip trivial single-character brace lines so structural braces don't pad false duplicates
      if (norm && norm !== '{' && norm !== '}' && norm !== ');' && !norm.startsWith('import ')) {
        nonEmpty.push({ lineNo: idx + 1, norm });
      }
    }

    const currentHashes = new Set<string>();
    const findings: Finding[] = [];

    if (nonEmpty.length < MIN_DUPLICATE_LINES) {
      return findings;
    }

    let lastReportedEndLine = -1;

    for (let i = 0; i <= nonEmpty.length - MIN_DUPLICATE_LINES; i++) {
      const window = nonEmpty.slice(i, i + MIN_DUPLICATE_LINES);
      const startLine = window[0].lineNo;
      const endLine = window[window.length - 1].lineNo;
      const blockStr = window.map((w) => w.norm).join('\n');

      // Require meaningful token length
      if (blockStr.length < 70) continue;

      const blockHash = crypto.createHash('sha256').update(blockStr, 'utf8').digest('hex').slice(0, 16);
      currentHashes.add(blockHash);

      const existing = this.blockIndex.get(blockHash);
      if (existing && existing.length > 0) {
        const match = existing.find(
          (loc) => loc.file !== filePath || Math.abs(loc.startLine - startLine) >= MIN_DUPLICATE_LINES
        );

        // Coalesce overlapping consecutive sliding windows so we report clean distinct duplicate blocks
        if (match && startLine > lastReportedEndLine) {
          const rawSnippet = lines.slice(startLine - 1, endLine).join('\n');
          const otherDisplay = path.basename(match.file);
          const span = endLine - startLine + 1;

          findings.push({
            id: `dup-${startLine}`,
            file: filePath,
            line: startLine,
            end_line: endLine,
            rule_id: 'CP-DUP-001',
            category: 'duplicate',
            severity: span > 15 ? 'medium' : 'low',
            confidence: 'high',
            title: `Duplicated Code Block (${span} lines)`,
            message: `Normalized ${MIN_DUPLICATE_LINES}+ statement block duplicates ${otherDisplay}:${match.startLine}-${match.endLine}.`,
            why_it_matters:
              'Copy-pasted logic forces parallel bug fixes across files and silently diverges over time.',
            suggested_fix: `Extract the shared routine into a single reusable module imported by both files.`,
            snippet: rawSnippet,
            fingerprint: computeFingerprint(filePath, 'CP-DUP-001', rawSnippet),
            is_new: false,
            dismissed: false,
          });
          lastReportedEndLine = endLine;
        }
      }

      const list = this.blockIndex.get(blockHash) || [];
      list.push({ file: filePath, startLine, endLine });
      this.blockIndex.set(blockHash, list);
    }

    this.fileHashes.set(filePath, currentHashes);
    return findings;
  }
}
