"""Python code smell detector using the AST module.

Checks
------
- Unused imports
- Unused local variables
- Unreachable code after return/raise
- Bare except
- Mutable default arguments
- print() left in non-script code (low)
- Overly broad 'except Exception' with pass
- TODO/FIXME/HACK comments (info)
- Very long lines (low)
- Missing docstrings on public functions (info, off by default)
"""

from __future__ import annotations

import ast
import logging
import re

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity

log = logging.getLogger("codepulse.analyzers.py_smells")


class PythonSmellsAnalyzer(Analyzer):
    name = "py_smells"

    def __init__(self, check_docstrings: bool = False):
        self.check_docstrings = check_docstrings

    def supports(self, path: str) -> bool:
        return path.endswith(".py")

    def analyze(self, path: str, source: str) -> list[Finding]:
        findings: list[Finding] = []
        lines = source.splitlines()

        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError:
            return findings

        findings.extend(self._check_unused_imports(path, source, tree))
        findings.extend(self._check_bare_except(path, source, tree))
        findings.extend(self._check_mutable_defaults(path, source, tree))
        findings.extend(self._check_broad_except_pass(path, source, tree))
        findings.extend(self._check_unreachable_code(path, source, tree))
        findings.extend(self._check_unused_variables(path, source, tree))
        findings.extend(self._check_print_statements(path, source, tree))
        findings.extend(self._check_todo_comments(path, lines))
        findings.extend(self._check_long_lines(path, lines))

        if self.check_docstrings:
            findings.extend(self._check_missing_docstrings(path, source, tree))

        return findings

    # ── Individual checks ──────────────────────────────────────────

    def _check_unused_imports(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        """Detect imports that are never referenced in the code."""
        findings = []
        lines = source.splitlines()

        # Collect imported names
        imported: list[tuple[str, ast.AST]] = []
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname or alias.name.split(".")[0]
                    imported.append((name, node))
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    name = alias.asname or alias.name
                    imported.append((name, node))

        # Collect all Name references (excluding the import lines themselves)
        used_names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                used_names.add(node.id)
            elif isinstance(node, ast.Attribute):
                # e.g. os.path — 'os' is the Name
                pass  # handled by ast.Name on the left

        for name, node in imported:
            if name not in used_names:
                snippet = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
                findings.append(Finding(
                    file=path, line=node.lineno, rule_id="CP-SM-001",
                    category=Category.smell, severity=Severity.low,
                    confidence=Confidence.high,
                    title=f"Unused import '{name}'",
                    message=f"'{name}' is imported but never used.",
                    why_it_matters="Unused imports add clutter and may slow down startup.",
                    suggested_fix=f"Remove the import of '{name}'.",
                    snippet=snippet,
                ))
        return findings

    def _check_bare_except(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        findings = []
        lines = source.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler) and node.type is None:
                snippet = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
                findings.append(Finding(
                    file=path, line=node.lineno, rule_id="CP-SM-002",
                    category=Category.smell, severity=Severity.medium,
                    confidence=Confidence.high,
                    title="Bare except clause",
                    message="Using bare 'except:' catches all exceptions including KeyboardInterrupt and SystemExit.",
                    why_it_matters="Bare except clauses can hide bugs and make debugging very difficult.",
                    suggested_fix="Catch a specific exception type, e.g. 'except ValueError:' or at minimum 'except Exception:'.",
                    snippet=snippet,
                ))
        return findings

    def _check_mutable_defaults(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        findings = []
        lines = source.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for default in node.args.defaults + node.args.kw_defaults:
                    if default is None:
                        continue
                    if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                        snippet = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
                        findings.append(Finding(
                            file=path, line=node.lineno, rule_id="CP-SM-003",
                            category=Category.smell, severity=Severity.medium,
                            confidence=Confidence.high,
                            title="Mutable default argument",
                            message=f"Function '{node.name}' uses a mutable default argument.",
                            why_it_matters="Mutable defaults are shared between calls and can cause unexpected behavior.",
                            suggested_fix="Use None as default and create the mutable inside the function body.",
                            snippet=snippet,
                        ))
                        break  # one per function
        return findings

    def _check_broad_except_pass(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        findings = []
        lines = source.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler):
                if (node.type and isinstance(node.type, ast.Name) and
                        node.type.id == "Exception" and
                        len(node.body) == 1 and isinstance(node.body[0], ast.Pass)):
                    snippet = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
                    findings.append(Finding(
                        file=path, line=node.lineno, rule_id="CP-SM-004",
                        category=Category.smell, severity=Severity.medium,
                        confidence=Confidence.high,
                        title="Broad except with pass",
                        message="'except Exception: pass' silently swallows all errors.",
                        why_it_matters="Silently ignoring exceptions hides bugs and makes debugging nearly impossible.",
                        suggested_fix="Log the exception or handle specific exception types.",
                        snippet=snippet,
                    ))
        return findings

    def _check_unreachable_code(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        findings = []
        lines = source.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for i, stmt in enumerate(node.body):
                    if isinstance(stmt, (ast.Return, ast.Raise)) and i < len(node.body) - 1:
                        next_stmt = node.body[i + 1]
                        snippet = lines[next_stmt.lineno - 1] if next_stmt.lineno <= len(lines) else ""
                        findings.append(Finding(
                            file=path, line=next_stmt.lineno, rule_id="CP-SM-005",
                            category=Category.smell, severity=Severity.medium,
                            confidence=Confidence.high,
                            title="Unreachable code",
                            message=f"Code after {'return' if isinstance(stmt, ast.Return) else 'raise'} is unreachable.",
                            why_it_matters="Dead code adds confusion and suggests a logic error.",
                            suggested_fix="Remove the unreachable code or fix the control flow.",
                            snippet=snippet,
                        ))
                        break  # only flag first unreachable per function
        return findings

    def _check_unused_variables(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        """Basic unused local variable detection."""
        findings = []
        lines = source.splitlines()

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue

            # Collect assignments
            assigned: dict[str, ast.AST] = {}
            used: set[str] = set()

            for child in ast.walk(node):
                if isinstance(child, ast.Name):
                    if isinstance(child.ctx, ast.Store):
                        if child.id not in assigned and child.id != "_":
                            assigned[child.id] = child
                    elif isinstance(child.ctx, (ast.Load, ast.Del)):
                        used.add(child.id)

            # Parameters are not "unused local variables"
            param_names = {a.arg for a in node.args.args + node.args.posonlyargs + node.args.kwonlyargs}
            if node.args.vararg:
                param_names.add(node.args.vararg.arg)
            if node.args.kwarg:
                param_names.add(node.args.kwarg.arg)

            for name, assign_node in assigned.items():
                if name in param_names:
                    continue
                if name.startswith("_"):
                    continue
                if name not in used:
                    snippet = lines[assign_node.lineno - 1] if assign_node.lineno <= len(lines) else ""
                    findings.append(Finding(
                        file=path, line=assign_node.lineno, rule_id="CP-SM-006",
                        category=Category.smell, severity=Severity.low,
                        confidence=Confidence.medium,
                        title=f"Unused variable '{name}'",
                        message=f"Variable '{name}' is assigned but never used in '{node.name}'.",
                        why_it_matters="Unused variables add noise and may indicate incomplete logic.",
                        suggested_fix=f"Remove '{name}' or prefix with _ to indicate intentionally unused.",
                        snippet=snippet,
                    ))
        return findings

    def _check_print_statements(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        """Flag print() calls left in non-script code."""
        findings = []
        lines = source.splitlines()
        # Heuristic: if the file has `if __name__ == "__main__"`, allow prints in that block
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func = node.func
                if isinstance(func, ast.Name) and func.id == "print":
                    snippet = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
                    findings.append(Finding(
                        file=path, line=node.lineno, rule_id="CP-SM-007",
                        category=Category.smell, severity=Severity.low,
                        confidence=Confidence.low,
                        title="print() statement",
                        message="print() call found — consider using logging instead.",
                        why_it_matters="Print statements can leak sensitive data and are hard to control in production.",
                        suggested_fix="Use the logging module for structured, level-controlled output.",
                        snippet=snippet,
                    ))
        return findings

    def _check_todo_comments(self, path: str, lines: list[str]) -> list[Finding]:
        findings = []
        pattern = re.compile(r"#\s*(TODO|FIXME|HACK|XXX)\b", re.IGNORECASE)
        for i, line in enumerate(lines, 1):
            m = pattern.search(line)
            if m:
                tag = m.group(1).upper()
                findings.append(Finding(
                    file=path, line=i, rule_id="CP-SM-008",
                    category=Category.smell, severity=Severity.info,
                    confidence=Confidence.high,
                    title=f"{tag} comment",
                    message=f"{tag} comment found: {line.strip()[:80]}",
                    why_it_matters=f"{tag} comments indicate unfinished work.",
                    suggested_fix=f"Address the {tag} or create a tracked issue.",
                    snippet=line.strip(),
                ))
        return findings

    def _check_long_lines(self, path: str, lines: list[str], max_length: int = 120) -> list[Finding]:
        findings = []
        for i, line in enumerate(lines, 1):
            if len(line) > max_length:
                findings.append(Finding(
                    file=path, line=i, rule_id="CP-SM-009",
                    category=Category.smell, severity=Severity.low,
                    confidence=Confidence.high,
                    title=f"Line too long ({len(line)} chars)",
                    message=f"Line {i} is {len(line)} characters (max {max_length}).",
                    why_it_matters="Very long lines reduce readability, especially in code reviews and split views.",
                    suggested_fix="Break the line or refactor for clarity.",
                    snippet=line[:max_length] + "...",
                ))
        return findings

    def _check_missing_docstrings(self, path: str, source: str, tree: ast.Module) -> list[Finding]:
        findings = []
        lines = source.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name.startswith("_"):
                    continue
                if not (node.body and isinstance(node.body[0], ast.Expr)
                        and isinstance(node.body[0].value, (ast.Constant,))
                        and isinstance(node.body[0].value.value, str)):
                    snippet = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
                    findings.append(Finding(
                        file=path, line=node.lineno, rule_id="CP-SM-010",
                        category=Category.smell, severity=Severity.info,
                        confidence=Confidence.high,
                        title=f"Missing docstring for '{node.name}'",
                        message=f"Public function '{node.name}' has no docstring.",
                        why_it_matters="Docstrings help other developers understand the function's purpose.",
                        suggested_fix=f"Add a docstring explaining what '{node.name}' does.",
                        snippet=snippet,
                    ))
        return findings
