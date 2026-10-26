import { computeFingerprint } from '../models.ts';
import type { Finding } from '../models.ts';
import type { BaseAnalyzer } from './base.ts';
import { parsePythonFunctions } from './pyParser.ts';
import type { ParsedPyFunction } from './pyParser.ts';

function computeFunctionComplexity(fn: ParsedPyFunction): { complexity: number; maxNesting: number } {
  let score = 1;
  const branchIndentStack: number[] = [];
  let maxNesting = 0;

  for (const b of fn.bodyLines) {
    const code = b.code;
    if (!code) continue;

    // Pop indent stack to current indentation level
    while (branchIndentStack.length > 0 && b.indent <= branchIndentStack[branchIndentStack.length - 1]) {
      branchIndentStack.pop();
    }

    // Control flow statements
    const isNestingBlock = /^(?:if|for|async\s+for|while|try|with|async\s+with)\b/.test(code);
    const isDecisionBranch = /^(?:if|elif|for|async\s+for|while|except|with|async\s+with|assert|case)\b/.test(
      code
    );

    if (isDecisionBranch) {
      score += 1;
    }

    if (isNestingBlock) {
      branchIndentStack.push(b.indent);
      if (branchIndentStack.length > maxNesting) {
        maxNesting = branchIndentStack.length;
      }
    }

    // Boolean operators 'and' / 'or'
    const boolOps = code.match(/\b(?:and|or)\b/g);
    if (boolOps) {
      score += boolOps.length;
    }

    // Comprehensions (inline ' for ... in ')
    if (!/^(?:for|async\s+for)\b/.test(code)) {
      const comps = code.match(/\bfor\s+[A-Za-z0-9_,\s]+\s+in\b/g);
      if (comps) {
        score += comps.length;
      }
    }
  }

  return { complexity: score, maxNesting };
}

export class PythonComplexityAnalyzer implements BaseAnalyzer {
  readonly name = 'PythonComplexityAnalyzer';

  supports(language: string, filePath: string): boolean {
    return language === 'python' || filePath.endsWith('.py');
  }

  analyze(filePath: string, source: string): [Finding[], number[]] {
    const lines = source.split(/\r?\n/);
    const functions = parsePythonFunctions(source);
    const findings: Finding[] = [];
    const complexities: number[] = [];

    const getSnippet = (start: number, end: number) =>
      lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join('\n');

    for (const fn of functions) {
      const { complexity, maxNesting } = computeFunctionComplexity(fn);
      complexities.push(complexity);
      const snippet = getSnippet(fn.startLine, Math.min(fn.startLine + 3, fn.endLine));

      if (complexity > 25) {
        findings.push({
          id: `cmp-crit-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.endLine,
          rule_id: 'CP-CMP-003',
          category: 'complexity',
          severity: 'critical',
          confidence: 'high',
          title: `Critical Cyclomatic Complexity (${complexity}) in '${fn.name}'`,
          message: `Function '${fn.name}' has a cyclomatic complexity of ${complexity} (threshold: >25).`,
          why_it_matters:
            'Extremely complex functions require exponential test cases and are prone to subtle regressions.',
          suggested_fix: 'Decompose this function into smaller, single-purpose helper routines.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-003', snippet),
          is_new: false,
          dismissed: false,
        });
      } else if (complexity > 15) {
        findings.push({
          id: `cmp-high-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.endLine,
          rule_id: 'CP-CMP-002',
          category: 'complexity',
          severity: 'high',
          confidence: 'high',
          title: `High Cyclomatic Complexity (${complexity}) in '${fn.name}'`,
          message: `Function '${fn.name}' has a cyclomatic complexity of ${complexity} (threshold: >15).`,
          why_it_matters: 'High decision branching increases maintenance cost and bug density.',
          suggested_fix: 'Extract sub-pipelines and replace deep conditionals with dispatch tables.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-002', snippet),
          is_new: false,
          dismissed: false,
        });
      } else if (complexity > 10) {
        findings.push({
          id: `cmp-med-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.endLine,
          rule_id: 'CP-CMP-001',
          category: 'complexity',
          severity: 'medium',
          confidence: 'high',
          title: `Moderate Cyclomatic Complexity (${complexity}) in '${fn.name}'`,
          message: `Function '${fn.name}' has a cyclomatic complexity of ${complexity} (threshold: >10).`,
          why_it_matters: 'Elevated branching makes unit testing and code review harder.',
          suggested_fix: 'Simplify compound boolean branches or extract helper functions.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-001', snippet),
          is_new: false,
          dismissed: false,
        });
      }

      const fnLength = fn.endLine - fn.startLine + 1;
      if (fnLength > 100) {
        findings.push({
          id: `cmp-len-high-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.endLine,
          rule_id: 'CP-CMP-005',
          category: 'complexity',
          severity: 'high',
          confidence: 'high',
          title: `Excessive Function Length (${fnLength} lines) in '${fn.name}'`,
          message: `Function '${fn.name}' spans ${fnLength} lines (threshold: >100).`,
          why_it_matters: 'Functions exceeding 100 lines violate Single Responsibility and obscure control flow.',
          suggested_fix: 'Split logical phases into focused, independently testable subroutines.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-005', snippet),
          is_new: false,
          dismissed: false,
        });
      } else if (fnLength > 50) {
        findings.push({
          id: `cmp-len-med-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.endLine,
          rule_id: 'CP-CMP-004',
          category: 'complexity',
          severity: 'medium',
          confidence: 'high',
          title: `Long Function (${fnLength} lines) in '${fn.name}'`,
          message: `Function '${fn.name}' spans ${fnLength} lines (threshold: >50).`,
          why_it_matters: 'Functions over 50 lines typically bundle multiple responsibilities.',
          suggested_fix: 'Extract cohesive helper functions.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-004', snippet),
          is_new: false,
          dismissed: false,
        });
      }

      const cleanParamCount = fn.params.filter((p) => !p.startsWith('*') && p !== 'self' && p !== 'cls').length;
      if (cleanParamCount > 6) {
        findings.push({
          id: `cmp-args-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.headerEndLine,
          rule_id: 'CP-CMP-007',
          category: 'complexity',
          severity: 'low',
          confidence: 'high',
          title: `Too Many Parameters (${cleanParamCount}) in '${fn.name}'`,
          message: `Function '${fn.name}' accepts ${cleanParamCount} parameters (threshold: >6).`,
          why_it_matters: 'Long parameter lists are error-prone at call sites and difficult to evolve.',
          suggested_fix: 'Group cohesive arguments into a dataclass, TypedDict, or Pydantic model.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-007', snippet),
          is_new: false,
          dismissed: false,
        });
      }

      if (maxNesting > 4) {
        findings.push({
          id: `cmp-nest-${fn.startLine}`,
          file: filePath,
          line: fn.startLine,
          end_line: fn.endLine,
          rule_id: 'CP-CMP-006',
          category: 'complexity',
          severity: 'medium',
          confidence: 'high',
          title: `Deep Nesting (${maxNesting} levels) in '${fn.name}'`,
          message: `Function '${fn.name}' reaches a nesting depth of ${maxNesting} (threshold: >4).`,
          why_it_matters: 'Deeply nested blocks create the arrow anti-pattern and spike cognitive load.',
          suggested_fix: 'Invert conditions into early-return guard clauses.',
          snippet,
          fingerprint: computeFingerprint(filePath, 'CP-CMP-006', snippet),
          is_new: false,
          dismissed: false,
        });
      }
    }

    return [findings, complexities];
  }
}
