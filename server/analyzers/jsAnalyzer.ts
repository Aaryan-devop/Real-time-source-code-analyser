import { computeFingerprint } from '../models.ts';
import type { Finding } from '../models.ts';
import type { BaseAnalyzer } from './base.ts';

const EVAL_PATTERN = /\beval\s*\(([^)]+)\)/;
const NEW_FUNC_PATTERN = /\bnew\s+Function\s*\(([^)]+)\)/;
const INNER_HTML_PATTERN = /\.innerHTML\s*=\s*(?!['"`]\s*['"`])(.+)/;
const DANGEROUS_HTML_PATTERN = /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*(?!['"`])(.+)/;
const DOC_WRITE_PATTERN = /\bdocument\.write\s*\((.+)\)/;
const CHILD_PROCESS_PATTERN =
  /\b(?:child_process|cp|exec|execSync)\b.*(?:\bexec|\bexecSync)\s*\((?:`[^`]*\$\{[^}]+\}|[A-Za-z0-9_.]+\s*\+|['"][^'"]*['"]\s*\+)/;
const CONSOLE_LOG_PATTERN = /\bconsole\.log\s*\(/;
const EMPTY_CATCH_PATTERN = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/;

function stripJsStringsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function analyzeJsFunctionComplexities(filePath: string, lines: string[]): { findings: Finding[]; scores: number[] } {
  const findings: Finding[] = [];
  const scores: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    const fnMatch =
      trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/) ||
      trimmed.match(/^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*\{/);

    if (!fnMatch) continue;
    const fnName = fnMatch[1];
    const startLine = i + 1;

    let braceDepth = 0;
    let opened = false;
    let endLine = startLine;
    let complexity = 1;

    for (let k = i; k < lines.length; k++) {
      const clean = stripJsStringsAndComments(lines[k]);
      for (const ch of clean) {
        if (ch === '{') {
          braceDepth++;
          opened = true;
        } else if (ch === '}') {
          braceDepth--;
        }
      }

      if (k > i) {
        const branches = clean.match(/\b(?:if|for|while|case|catch)\b/g);
        if (branches) complexity += branches.length;
        const bools = clean.match(/(?:&&|\|\||\?\s*[^.:])/g);
        if (bools) complexity += bools.length;
      }

      endLine = k + 1;
      if (opened && braceDepth <= 0) {
        break;
      }
    }

    if (opened) {
      scores.push(complexity);
      const snippet = lines.slice(startLine - 1, Math.min(startLine + 2, endLine)).join('\n');
      if (complexity > 15) {
        findings.push({
          id: `js-cmp-high-${startLine}`,
          file: filePath,
          line: startLine,
          end_line: endLine,
          rule_id: 'CP-CMP-002',
          category: 'complexity',
          severity: complexity > 25 ? 'critical' : 'high',
          confidence: 'high',
          title: `High Cyclomatic Complexity (${complexity}) in '${fnName}'`,
          message: `Function '${fnName}' has cyclomatic complexity ${complexity} (threshold: >15).`,
          why_it_matters: 'Complex JS/TS handlers are error-prone and difficult to unit test thoroughly.',
          suggested_fix: 'Extract helper functions and simplify nested conditional branches.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-002', snippet),
          is_new: false,
          dismissed: false,
        });
      } else if (complexity > 10) {
        findings.push({
          id: `js-cmp-med-${startLine}`,
          file: filePath,
          line: startLine,
          end_line: endLine,
          rule_id: 'CP-CMP-001',
          category: 'complexity',
          severity: 'medium',
          confidence: 'high',
          title: `Moderate Cyclomatic Complexity (${complexity}) in '${fnName}'`,
          message: `Function '${fnName}' has cyclomatic complexity ${complexity} (threshold: >10).`,
          why_it_matters: 'Elevated branching complexity reduces readability.',
          suggested_fix: 'Decompose complex branches into named helper functions.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-001', snippet),
          is_new: false,
          dismissed: false,
        });
      }
    }
  }

  return { findings, scores };
}

export class JavaScriptAnalyzer implements BaseAnalyzer {
  readonly name = 'JavaScriptAnalyzer';
  readonly engineMode = 'ast-token';

  supports(language: string, filePath: string): boolean {
    return (
      language === 'javascript' ||
      language === 'typescript' ||
      /\.(?:js|jsx|mjs|cjs|ts|tsx)$/i.test(filePath)
    );
  }

  analyze(filePath: string, source: string): [Finding[], number[]] {
    const lines = source.split(/\r?\n/);
    const { findings, scores } = analyzeJsFunctionComplexities(filePath, lines);

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const line = lines[idx];
      const stripped = line.trim();
      if (!stripped || stripped.startsWith('//') || stripped.startsWith('/*') || stripped.startsWith('*')) {
        continue;
      }

      const clean = stripJsStringsAndComments(line);

      // 1. eval()
      if (EVAL_PATTERN.test(clean)) {
        findings.push({
          id: `js-eval-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-001',
          category: 'security',
          severity: 'critical',
          confidence: 'high',
          title: 'Dynamic Code Execution via eval() [CWE-95]',
          message: 'eval() executes arbitrary JavaScript code with full lexical scope privileges.',
          why_it_matters: 'Untrusted input reaching eval() enables Cross-Site Scripting (XSS) or server-side RCE.',
          suggested_fix: 'Parse structured data with JSON.parse() or map keys to explicit handlers.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-001', stripped),
          is_new: false,
          dismissed: false,
        });
      }

      // 2. new Function()
      if (NEW_FUNC_PATTERN.test(clean)) {
        findings.push({
          id: `js-newfunc-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-002',
          category: 'security',
          severity: 'high',
          confidence: 'high',
          title: 'Unsafe Function Constructor [CWE-95]',
          message: 'new Function() compiles dynamic strings into executable functions at runtime.',
          why_it_matters: 'Bypasses Content Security Policy (CSP) protections and enables code injection.',
          suggested_fix: 'Replace dynamic string compilation with static callback functions.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-002', stripped),
          is_new: false,
          dismissed: false,
        });
      }

      // 3. innerHTML / dangerouslySetInnerHTML
      if (INNER_HTML_PATTERN.test(line) || DANGEROUS_HTML_PATTERN.test(line)) {
        findings.push({
          id: `js-xss-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-003',
          category: 'security',
          severity: 'high',
          confidence: 'high',
          title: 'DOM XSS Sink via Unsanitized HTML Injection [CWE-79]',
          message: 'Dynamic HTML assigned directly to DOM sink without sanitization.',
          why_it_matters: 'Allows attacker-supplied <script> or event handlers to steal session credentials.',
          suggested_fix: 'Assign textContent for plain text or sanitize markup with DOMPurify.sanitize().',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-003', stripped),
          is_new: false,
          dismissed: false,
          can_autofix: /\.innerHTML\s*=/.test(line),
        });
      }

      // 4. document.write()
      if (DOC_WRITE_PATTERN.test(clean)) {
        findings.push({
          id: `js-docwrite-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-004',
          category: 'security',
          severity: 'medium',
          confidence: 'high',
          title: 'Unsafe document.write() Usage [CWE-79]',
          message: 'document.write() injects raw markup directly into the document parser stream.',
          why_it_matters: 'Blocks parser rendering and introduces DOM-based XSS vectors.',
          suggested_fix: 'Create DOM nodes safely using document.createElement() and textContent.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-004', stripped),
          is_new: false,
          dismissed: false,
        });
      }

      // 5. child_process command injection
      if (CHILD_PROCESS_PATTERN.test(line)) {
        findings.push({
          id: `js-cmd-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-005',
          category: 'security',
          severity: 'critical',
          confidence: 'high',
          title: 'OS Command Injection via child_process.exec [CWE-78]',
          message: 'Shell command constructed dynamically via template interpolation or string concatenation.',
          why_it_matters: 'Shell metacharacters allow remote attackers to execute arbitrary system commands.',
          suggested_fix: 'Use child_process.execFile() or spawn() with a discrete arguments array.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-005', stripped),
          is_new: false,
          dismissed: false,
        });
      }

      // 6. Loose equality (== or !=, excluding ===, !==, and == null idiom if strict check desired)
      if (/(?:[^!=]==[^=]|[^!=]!=[^=])/.test(clean)) {
        findings.push({
          id: `js-loose-eq-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-006',
          category: 'smell',
          severity: 'low',
          confidence: 'high',
          title: 'Type-Coercing Equality Operator (== / !=)',
          message: 'Loose equality operator performs implicit JavaScript type coercion.',
          why_it_matters: "Implicit coercion (e.g., '' == 0 or '0' == false) causes subtle validation bugs.",
          suggested_fix: 'Replace == and != with strict === and !== operators.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-006', stripped),
          is_new: false,
          dismissed: false,
          can_autofix: true,
        });
      }

      // 7. console.log()
      if (CONSOLE_LOG_PATTERN.test(clean)) {
        findings.push({
          id: `js-log-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-007',
          category: 'smell',
          severity: 'low',
          confidence: 'medium',
          title: 'console.log() Statement in Source',
          message: 'Unstructured console.log() debug output left in module.',
          why_it_matters: 'Can leak sensitive payloads to browser DevTools or clutter server stdout.',
          suggested_fix: 'Remove debug logging or route through a structured logger.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-007', stripped),
          is_new: false,
          dismissed: false,
          can_autofix: true,
        });
      }

      // 8. Empty catch block
      if (EMPTY_CATCH_PATTERN.test(clean)) {
        findings.push({
          id: `js-empty-catch-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-JS-008',
          category: 'smell',
          severity: 'medium',
          confidence: 'high',
          title: 'Empty catch {} Block',
          message: 'Caught error is silently ignored with an empty block.',
          why_it_matters: 'Swallowing rejected promises or runtime errors hides broken application states.',
          suggested_fix: 'Log the error or propagate a typed failure state to the caller.',
          snippet: stripped,
          fingerprint: computeFingerprint(filePath, 'CP-JS-008', stripped),
          is_new: false,
          dismissed: false,
        });
      }
    }

    return [findings, scores];
  }
}
