"""Python complexity analyzer using the AST module.

Checks
------
- Cyclomatic complexity per function (>10 medium, >15 high, >25 critical)
- Function length (>50 lines medium, >100 high)
- Nesting depth (>4 medium)
- Too many parameters (>6 low)
- File-level complexity_avg and complexity_max (stored on FileReport)
"""

from __future__ import annotations

import ast
import logging
from typing import Any

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity

log = logging.getLogger("codepulse.analyzers.py_complexity")


class PythonComplexityAnalyzer(Analyzer):
    name = "py_complexity"

    # Stored after analysis for the engine to pick up
    complexity_avg: float = 0.0
    complexity_max: int = 0

    def supports(self, path: str) -> bool:
        return path.endswith(".py")

    def analyze(self, path: str, source: str) -> list[Finding]:
        findings: list[Finding] = []
        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError:
            return findings  # handled by engine

        func_complexities: list[int] = []

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                cx = self._cyclomatic_complexity(node)
                func_complexities.append(cx)

                # Complexity
                if cx > 25:
                    findings.append(self._finding(
                        path, node, f"CP-CX-001", Severity.critical, Confidence.high,
                        f"Very high complexity ({cx})",
                        f"Function '{node.name}' has cyclomatic complexity {cx} (>25).",
                        "Highly complex functions are hard to test and maintain. "
                        "Each branch adds a potential for bugs.",
                        "Break this function into smaller helper functions, each handling one concern.",
                        source, cx,
                    ))
                elif cx > 15:
                    findings.append(self._finding(
                        path, node, "CP-CX-001", Severity.high, Confidence.high,
                        f"High complexity ({cx})",
                        f"Function '{node.name}' has cyclomatic complexity {cx} (>15).",
                        "Complex functions are difficult to test and understand.",
                        "Consider refactoring into smaller functions.",
                        source, cx,
                    ))
                elif cx > 10:
                    findings.append(self._finding(
                        path, node, "CP-CX-001", Severity.medium, Confidence.high,
                        f"Moderate complexity ({cx})",
                        f"Function '{node.name}' has cyclomatic complexity {cx} (>10).",
                        "Moderate complexity can lead to maintenance challenges over time.",
                        "Consider simplifying conditional logic or extracting helper functions.",
                        source, cx,
                    ))

                # Function length
                length = self._func_length(node)
                if length > 100:
                    findings.append(self._finding(
                        path, node, "CP-CX-002", Severity.high, Confidence.high,
                        f"Very long function ({length} lines)",
                        f"Function '{node.name}' is {length} lines long (>100).",
                        "Very long functions are hard to read, test and debug.",
                        "Break into smaller, well-named functions.",
                        source,
                    ))
                elif length > 50:
                    findings.append(self._finding(
                        path, node, "CP-CX-002", Severity.medium, Confidence.high,
                        f"Long function ({length} lines)",
                        f"Function '{node.name}' is {length} lines long (>50).",
                        "Long functions tend to do too many things.",
                        "Consider splitting into smaller functions with clear responsibilities.",
                        source,
                    ))

                # Nesting depth
                depth = self._max_nesting(node)
                if depth > 4:
                    findings.append(self._finding(
                        path, node, "CP-CX-003", Severity.medium, Confidence.high,
                        f"Deep nesting (depth {depth})",
                        f"Function '{node.name}' has nesting depth {depth} (>4).",
                        "Deeply nested code is hard to follow and error-prone.",
                        "Use early returns, guard clauses, or extract nested logic into helper functions.",
                        source,
                    ))

                # Too many parameters
                nparams = len(node.args.args) + len(node.args.posonlyargs) + len(node.args.kwonlyargs)
                if node.args.vararg:
                    nparams += 1
                if node.args.kwarg:
                    nparams += 1
                if nparams > 6:
                    findings.append(self._finding(
                        path, node, "CP-CX-004", Severity.low, Confidence.high,
                        f"Too many parameters ({nparams})",
                        f"Function '{node.name}' has {nparams} parameters (>6).",
                        "Functions with many parameters are hard to call correctly and suggest the function does too much.",
                        "Group related parameters into a data class or dictionary.",
                        source,
                    ))

        # File-level stats
        if func_complexities:
            self.complexity_avg = round(sum(func_complexities) / len(func_complexities), 1)
            self.complexity_max = max(func_complexities)
        else:
            self.complexity_avg = 0.0
            self.complexity_max = 0

        return findings

    # ── helpers ─────────────────────────────────────────────────────

    def _cyclomatic_complexity(self, func_node: ast.AST) -> int:
        """Count decision points inside a function (McCabe-style)."""
        cx = 1  # base path
        for node in ast.walk(func_node):
            if isinstance(node, (ast.If, ast.IfExp)):
                cx += 1
            elif isinstance(node, (ast.For, ast.AsyncFor)):
                cx += 1
            elif isinstance(node, (ast.While,)):
                cx += 1
            elif isinstance(node, ast.ExceptHandler):
                cx += 1
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                cx += 1
            elif isinstance(node, ast.BoolOp):
                # each 'and'/'or' adds a branch
                cx += len(node.values) - 1
            elif isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
                cx += len(node.generators)
            elif isinstance(node, ast.Match):
                cx += len(node.cases)
        return cx

    def _func_length(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
        """Approximate function length in source lines."""
        if not node.body:
            return 0
        first = node.body[0].lineno
        last = node.body[-1].end_lineno or node.body[-1].lineno
        return last - first + 1

    def _max_nesting(self, node: ast.AST, depth: int = 0) -> int:
        """Compute the maximum nesting depth inside a function."""
        max_d = depth
        nesting_nodes = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith,
                         ast.Try, ast.ExceptHandler)
        for child in ast.iter_child_nodes(node):
            if isinstance(child, nesting_nodes):
                max_d = max(max_d, self._max_nesting(child, depth + 1))
            else:
                max_d = max(max_d, self._max_nesting(child, depth))
        return max_d

    def _finding(
        self, path: str, node: ast.AST, rule_id: str,
        severity: Severity, confidence: Confidence,
        title: str, message: str, why: str, fix: str,
        source: str, complexity: int | None = None,
    ) -> Finding:
        lines = source.splitlines()
        line = getattr(node, "lineno", 1)
        end_line = getattr(node, "end_lineno", line)
        snippet_start = max(0, line - 1)
        snippet_end = min(len(lines), snippet_start + 5)
        snippet = "\n".join(lines[snippet_start:snippet_end])
        return Finding(
            file=path, line=line, end_line=end_line,
            rule_id=rule_id, category=Category.complexity,
            severity=severity, confidence=confidence,
            title=title, message=message,
            why_it_matters=why, suggested_fix=fix,
            snippet=snippet,
        )
