import { computeFingerprint } from '../models.ts';
import type { Finding } from '../models.ts';
import type { BaseAnalyzer } from './base.ts';
import { getIndentSpaces, parsePythonFunctions, stripPyCommentsAndStrings } from './pyParser.ts';

export class PythonSmellsAnalyzer implements BaseAnalyzer {
  readonly name = 'PythonSmellsAnalyzer';

  supports(language: string, filePath: string): boolean {
    return language === 'python' || filePath.endsWith('.py');
  }

  analyze(filePath: string, source: string): Finding[] {
    const lines = source.split(/\r?\n/);
    const findings: Finding[] = [];

    // 1. Collect top-level / module imports and check references
    const importedSymbols: { alias: string; rawName: string; line: number; rawLine: string }[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const rawLine = lines[idx];
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const fromMatch = trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/);
      if (fromMatch && fromMatch[1] !== '__future__') {
        const clause = fromMatch[2].replace(/[()]/g, '').split('#')[0];
        for (const part of clause.split(',')) {
          const item = part.trim();
          if (!item || item === '*') continue;
          const asMatch = item.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
          if (asMatch) {
            const rawName = asMatch[1];
            const alias = asMatch[2] || rawName;
            if (!alias.startsWith('_')) {
              importedSymbols.push({ alias, rawName, line: lineNo, rawLine });
            }
          }
        }
        continue;
      }

      const impMatch = trimmed.match(/^import\s+(.+)$/);
      if (impMatch) {
        const clause = impMatch[1].split('#')[0];
        for (const part of clause.split(',')) {
          const item = part.trim();
          const asMatch = item.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
          if (asMatch) {
            const rawName = asMatch[1];
            const alias = asMatch[2] || rawName.split('.')[0];
            if (!alias.startsWith('_')) {
              importedSymbols.push({ alias, rawName, line: lineNo, rawLine });
            }
          }
        }
      }
    }

    for (const imp of importedSymbols) {
      let used = false;
      const identRegex = new RegExp(`\\b${imp.alias}\\b`);
      for (let idx = 0; idx < lines.length; idx++) {
        if (idx + 1 === imp.line) continue;
        const lineWithoutComment = lines[idx].split('#')[0];
        if (identRegex.test(lineWithoutComment)) {
          used = true;
          break;
        }
      }
      if (!used) {
        findings.push({
          id: `sml-unused-imp-${imp.line}-${imp.alias}`,
          file: filePath,
          line: imp.line,
          end_line: imp.line,
          rule_id: 'CP-SML-001',
          category: 'smell',
          severity: 'low',
          confidence: 'high',
          title: `Unused Import '${imp.rawName}'`,
          message: `Module or symbol '${imp.rawName}' is imported but never referenced.`,
          why_it_matters: 'Unreferenced imports add startup overhead and obscure true module dependencies.',
          suggested_fix: 'Remove the unused import line.',
          snippet: imp.rawLine,
          fingerprint: computeFingerprint(filePath, 'CP-SML-001', imp.rawLine),
          is_new: false,
          dismissed: false,
          can_autofix: true,
        });
      }
    }

    // 2. Bare except: & broad silent except Exception: pass
    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const rawLine = lines[idx];
      const clean = stripPyCommentsAndStrings(rawLine);

      if (/^except\s*:\s*$/.test(clean)) {
        const nextLine = idx + 1 < lines.length ? lines[idx + 1] : '';
        const snippet = nextLine ? `${rawLine}\n${nextLine}` : rawLine;
        findings.push({
          id: `sml-bare-except-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: nextLine ? lineNo + 1 : lineNo,
          rule_id: 'CP-SML-004',
          category: 'smell',
          severity: 'medium',
          confidence: 'high',
          title: "Bare 'except:' Clause",
          message: "Bare 'except:' catches SystemExit and KeyboardInterrupt alongside standard errors.",
          why_it_matters: 'Hides fatal runtime faults and prevents clean process shutdown.',
          suggested_fix: "Specify explicit exception classes such as 'except Exception as err:'.",
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-SML-004', snippet),
          is_new: false,
          dismissed: false,
          can_autofix: true,
        });
      } else if (/^except\s+(?:Exception|BaseException)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*:\s*$/.test(clean)) {
        const exceptIndent = getIndentSpaces(rawLine);
        // Inspect immediate body statements of this except handler
        const handlerBody: string[] = [];
        let endHandlerLine = lineNo;
        for (let k = idx + 1; k < lines.length; k++) {
          const bTrim = lines[k].trim();
          if (!bTrim || bTrim.startsWith('#')) continue;
          const bIndent = getIndentSpaces(lines[k]);
          if (bIndent <= exceptIndent) break;
          handlerBody.push(stripPyCommentsAndStrings(lines[k]));
          endHandlerLine = k + 1;
        }
        if (handlerBody.length === 1 && (handlerBody[0] === 'pass' || handlerBody[0] === '...')) {
          const snippet = lines.slice(idx, endHandlerLine).join('\n');
          findings.push({
            id: `sml-broad-pass-${lineNo}`,
            file: filePath,
            line: lineNo,
            end_line: endHandlerLine,
            rule_id: 'CP-SML-005',
            category: 'smell',
            severity: 'medium',
            confidence: 'high',
            title: 'Silent Exception Suppression (except Exception: pass)',
            message: 'Exceptions are swallowed silently without logging or recovery.',
            why_it_matters: 'Silently discarded exceptions hide production failures and corrupt state.',
            suggested_fix: 'Log the caught exception with context or narrow the exception type.',
            snippet,
            fingerprint: computeFingerprint(filePath, 'CP-SML-005', snippet),
            is_new: false,
            dismissed: false,
          });
        }
      }
    }

    // 3. Function-level checks: mutable defaults, dead code, unused local variables
    const functions = parsePythonFunctions(source);
    for (const fn of functions) {
      // Mutable default arguments (=[], ={}, =set())
      for (const param of fn.params) {
        if (/=\s*(?:\[\s*\]|\{\s*\}|set\s*\(\s*\))$/.test(param)) {
          const snippet = lines.slice(fn.startLine - 1, fn.headerEndLine).join('\n');
          findings.push({
            id: `sml-mut-def-${fn.startLine}`,
            file: filePath,
            line: fn.startLine,
            end_line: fn.headerEndLine,
            rule_id: 'CP-SML-006',
            category: 'smell',
            severity: 'medium',
            confidence: 'high',
            title: `Mutable Default Argument in '${fn.name}'`,
            message: `Parameter '${param}' uses a mutable default container ([], {}, or set()).`,
            why_it_matters:
              'Python evaluates default arguments once at definition time, sharing mutated state across every invocation.',
            suggested_fix: "Default the parameter to 'None' and initialize a fresh list/dict inside the function body.",
            snippet,
            fingerprint: computeFingerprint(filePath, 'CP-SML-006', snippet),
            is_new: false,
            dismissed: false,
          });
          break;
        }
      }

      // Unreachable dead code after return / raise / break / continue at same indentation
      for (let bIdx = 0; bIdx < fn.bodyLines.length - 1; bIdx++) {
        const curr = fn.bodyLines[bIdx];
        const next = fn.bodyLines[bIdx + 1];
        if (
          /^(?:return|raise|break|continue)\b/.test(curr.code) &&
          next.indent === curr.indent &&
          !/^(?:elif|else|except|finally|case)\b/.test(next.code)
        ) {
          findings.push({
            id: `sml-dead-code-${next.lineNo}`,
            file: filePath,
            line: next.lineNo,
            end_line: next.lineNo,
            rule_id: 'CP-SML-003',
            category: 'smell',
            severity: 'medium',
            confidence: 'high',
            title: 'Unreachable / Dead Code',
            message: `Statement on line ${next.lineNo} is unreachable following control jump on line ${curr.lineNo}.`,
            why_it_matters: 'Unreachable statements signal logic bugs or incomplete refactors.',
            suggested_fix: 'Remove the unreachable statement or fix the preceding return/raise flow.',
            snippet: next.raw,
            fingerprint: computeFingerprint(filePath, 'CP-SML-003', next.raw),
            is_new: false,
            dismissed: false,
            can_autofix: true,
          });
        }
      }

      // Unused local variables
      const paramNames = new Set(
        fn.params.map((p) => p.replace(/^\*+/, '').split(/[=:]/)[0].trim()).filter(Boolean)
      );
      const assignedLocals = new Map<string, { lineNo: number; raw: string }>();

      for (const b of fn.bodyLines) {
        const assignMatch = b.code.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[^=]+)?=\s*(?!=)/);
        if (assignMatch) {
          const varName = assignMatch[1];
          if (!varName.startsWith('_') && !paramNames.has(varName) && !assignedLocals.has(varName)) {
            assignedLocals.set(varName, { lineNo: b.lineNo, raw: b.raw });
          }
        }
      }

      for (const [varName, info] of assignedLocals.entries()) {
        const varRegex = new RegExp(`\\b${varName}\\b`, 'g');
        let occurrences = 0;
        for (const b of fn.bodyLines) {
          const lineWithoutComments = b.raw.split('#')[0];
          const matches = lineWithoutComments.match(varRegex);
          if (matches) occurrences += matches.length;
        }
        if (occurrences <= 1) {
          findings.push({
            id: `sml-unused-var-${info.lineNo}-${varName}`,
            file: filePath,
            line: info.lineNo,
            end_line: info.lineNo,
            rule_id: 'CP-SML-002',
            category: 'smell',
            severity: 'low',
            confidence: 'medium',
            title: `Unused Local Variable '${varName}'`,
            message: `Local variable '${varName}' is assigned in '${fn.name}' but never read.`,
            why_it_matters: 'Unused variables clutter function scope and often indicate forgotten return values.',
            suggested_fix: `Reference '${varName}' where intended, remove it, or prefix with '_${varName}'.`,
            snippet: info.raw,
            fingerprint: computeFingerprint(filePath, 'CP-SML-002', info.raw),
            is_new: false,
            dismissed: false,
          });
        }
      }
    }

    // 4. Line-level checks: print(), >120 chars, TODO/FIXME/HACK
    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const rawLine = lines[idx];
      const clean = stripPyCommentsAndStrings(rawLine);

      if (/(?:^|[^\w.])print\s*\(/.test(clean)) {
        findings.push({
          id: `sml-print-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-SML-007',
          category: 'smell',
          severity: 'low',
          confidence: 'medium',
          title: 'print() Statement in Production Code',
          message: 'Direct standard output print() call detected instead of structured logging.',
          why_it_matters: 'print() lacks severity levels, timestamps, and structured log routing.',
          suggested_fix: "Replace print(...) with Python's logging module (e.g., logger.info(...)).",
          snippet: rawLine.trim(),
          fingerprint: computeFingerprint(filePath, 'CP-SML-007', rawLine.trim()),
          is_new: false,
          dismissed: false,
          can_autofix: true,
        });
      }

      if (rawLine.length > 120) {
        const shortSnip = `${rawLine.slice(0, 88)}...`;
        findings.push({
          id: `sml-longline-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-SML-008',
          category: 'smell',
          severity: 'low',
          confidence: 'high',
          title: 'Line Exceeds 120 Characters',
          message: `Line spans ${rawLine.length} characters (recommended limit: 120).`,
          why_it_matters: 'Overly wide lines cause horizontal scrolling and hinder side-by-side diff reviews.',
          suggested_fix: 'Wrap arguments or chained expressions across multiple lines.',
          snippet: shortSnip,
          fingerprint: computeFingerprint(filePath, 'CP-SML-008', rawLine.slice(0, 80)),
          is_new: false,
          dismissed: false,
        });
      }

      const todoMatch = rawLine.match(/#\s*(TODO|FIXME|HACK|BUG)\b:?\s*(.*)/i);
      if (todoMatch) {
        const tag = todoMatch[1].toUpperCase();
        const detail = todoMatch[2].trim() || 'Unresolved technical debt marker';
        findings.push({
          id: `sml-todo-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-SML-009',
          category: 'smell',
          severity: 'info',
          confidence: 'high',
          title: `${tag} Comment Marker`,
          message: `${tag}: ${detail}`,
          why_it_matters: 'Untracked code comments accumulate deferred work and edge-case debt.',
          suggested_fix: 'Address the item or link it to a tracked issue ticket.',
          snippet: rawLine.trim(),
          fingerprint: computeFingerprint(filePath, 'CP-SML-009', rawLine.trim()),
          is_new: false,
          dismissed: false,
        });
      }
    }

    return findings;
  }
}
