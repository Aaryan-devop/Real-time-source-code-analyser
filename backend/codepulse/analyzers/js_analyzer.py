"""JavaScript/TypeScript analyzer.

Tries to use tree-sitter for full analysis. Falls back to regex-based
security-only checks if tree-sitter is not available.

The engine status exposes which mode is active via `js_engine`.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity

log = logging.getLogger("codepulse.analyzers.js_analyzer")

# ── Try tree-sitter import ─────────────────────────────────────────────

_TREE_SITTER_AVAILABLE = False
try:
    from tree_sitter import Language, Parser
    import tree_sitter_javascript as tsjs
    _TREE_SITTER_AVAILABLE = True
    log.info("tree-sitter available — JS analyzer running in full mode.")
except ImportError:
    log.info("tree-sitter not available — JS analyzer using regex fallback.")


def js_engine() -> str:
    """Return the active JS analysis engine name."""
    return "tree-sitter" if _TREE_SITTER_AVAILABLE else "fallback"


# ── Regex fallback patterns (security-focused) ────────────────────────

_FALLBACK_RULES: list[dict[str, Any]] = [
    {
        "rule_id": "CP-JS-001", "title": "Use of eval()",
        "pattern": re.compile(r"\beval\s*\("),
        "severity": Severity.critical, "confidence": Confidence.high,
        "cwe": "CWE-95",
        "why": "eval() executes arbitrary code. If input is user-controlled, an attacker can run any code.",
        "fix": "Parse data with JSON.parse() or use a safer alternative.",
    },
    {
        "rule_id": "CP-JS-002", "title": "new Function() constructor",
        "pattern": re.compile(r"\bnew\s+Function\s*\("),
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-95",
        "why": "new Function() creates a function from a string, similar to eval().",
        "fix": "Avoid dynamically creating functions from strings.",
    },
    {
        "rule_id": "CP-JS-003", "title": "innerHTML assignment",
        "pattern": re.compile(r"\.innerHTML\s*="),
        "severity": Severity.high, "confidence": Confidence.medium,
        "cwe": "CWE-79",
        "why": "Setting innerHTML with user data enables Cross-Site Scripting (XSS).",
        "fix": "Use textContent for text or a DOM API that escapes HTML.",
    },
    {
        "rule_id": "CP-JS-004", "title": "dangerouslySetInnerHTML",
        "pattern": re.compile(r"dangerouslySetInnerHTML"),
        "severity": Severity.high, "confidence": Confidence.medium,
        "cwe": "CWE-79",
        "why": "dangerouslySetInnerHTML bypasses React's XSS protections.",
        "fix": "Sanitize the HTML with DOMPurify before using dangerouslySetInnerHTML.",
    },
    {
        "rule_id": "CP-JS-005", "title": "document.write()",
        "pattern": re.compile(r"document\.write\s*\("),
        "severity": Severity.medium, "confidence": Confidence.high,
        "cwe": "CWE-79",
        "why": "document.write() can introduce XSS and interferes with modern page loading.",
        "fix": "Use DOM manipulation methods like createElement and appendChild.",
    },
    {
        "rule_id": "CP-JS-006", "title": "child_process.exec with concatenation",
        "pattern": re.compile(r"(?:exec|execSync)\s*\([^)]*\+"),
        "severity": Severity.high, "confidence": Confidence.medium,
        "cwe": "CWE-78",
        "why": "Concatenating strings into exec() commands allows command injection.",
        "fix": "Use execFile() with an array of arguments instead.",
    },
    {
        "rule_id": "CP-JS-007", "title": "== instead of ===",
        "pattern": re.compile(r"[^!=]={2}[^=]"),
        "severity": Severity.low, "confidence": Confidence.medium,
        "why": "Loose equality (==) performs type coercion which can lead to unexpected behavior.",
        "fix": "Use strict equality (===) to avoid type coercion bugs.",
    },
    {
        "rule_id": "CP-JS-008", "title": "console.log left in code",
        "pattern": re.compile(r"\bconsole\.log\s*\("),
        "severity": Severity.low, "confidence": Confidence.low,
        "why": "console.log statements left in production code can leak information.",
        "fix": "Remove console.log or use a proper logging library.",
    },
    {
        "rule_id": "CP-JS-009", "title": "Empty catch block",
        "pattern": re.compile(r"catch\s*\([^)]*\)\s*\{\s*\}"),
        "severity": Severity.medium, "confidence": Confidence.high,
        "why": "Empty catch blocks silently swallow errors, making debugging very difficult.",
        "fix": "Log the error or handle it appropriately.",
    },
]


class JavaScriptAnalyzer(Analyzer):
    name = "js_analyzer"

    def supports(self, path: str) -> bool:
        return path.endswith((".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"))

    def analyze(self, path: str, source: str) -> list[Finding]:
        if _TREE_SITTER_AVAILABLE:
            return self._analyze_tree_sitter(path, source)
        return self._analyze_fallback(path, source)

    # ── Regex fallback ─────────────────────────────────────────────

    def _analyze_fallback(self, path: str, source: str) -> list[Finding]:
        findings: list[Finding] = []
        lines = source.splitlines()

        for i, line in enumerate(lines, 1):
            for rule in _FALLBACK_RULES:
                if rule["pattern"].search(line):
                    findings.append(Finding(
                        file=path, line=i,
                        rule_id=rule["rule_id"],
                        category=Category.security if rule.get("cwe") else Category.smell,
                        severity=rule["severity"],
                        confidence=rule["confidence"],
                        title=rule["title"],
                        message=f"{rule['title']} at line {i}.",
                        why_it_matters=rule["why"],
                        suggested_fix=rule["fix"],
                        snippet=line.strip()[:120],
                        cwe=rule.get("cwe"),
                    ))
        return findings

    # ── tree-sitter full analysis ──────────────────────────────────

    def _analyze_tree_sitter(self, path: str, source: str) -> list[Finding]:
        """Full analysis using tree-sitter AST."""
        findings: list[Finding] = []
        lines = source.splitlines()

        try:
            JS_LANGUAGE = Language(tsjs.language())
            parser = Parser(JS_LANGUAGE)
            tree = parser.parse(source.encode())
        except Exception as exc:
            log.warning("tree-sitter parse failed for %s: %s", path, exc)
            return self._analyze_fallback(path, source)

        root = tree.root_node

        # Walk all nodes
        self._walk_ts(root, path, lines, findings)

        # Also run regex fallback rules for things tree-sitter doesn't easily catch
        for i, line in enumerate(lines, 1):
            for rule in _FALLBACK_RULES:
                if rule["rule_id"] in ("CP-JS-007", "CP-JS-008"):  # low-priority regex rules
                    if rule["pattern"].search(line):
                        # Avoid duplicates
                        if not any(f.line == i and f.rule_id == rule["rule_id"] for f in findings):
                            findings.append(Finding(
                                file=path, line=i,
                                rule_id=rule["rule_id"],
                                category=Category.smell,
                                severity=rule["severity"],
                                confidence=rule["confidence"],
                                title=rule["title"],
                                message=f"{rule['title']} at line {i}.",
                                why_it_matters=rule["why"],
                                suggested_fix=rule["fix"],
                                snippet=line.strip()[:120],
                            ))

        return findings

    def _walk_ts(self, node, path: str, lines: list[str], findings: list[Finding]) -> None:
        """Recursively walk the tree-sitter AST looking for issues."""
        # Function complexity and length
        if node.type in ("function_declaration", "function", "arrow_function", "method_definition"):
            body = None
            for child in node.children:
                if child.type == "statement_block":
                    body = child
                    break
            if body:
                length = body.end_point[0] - body.start_point[0] + 1
                if length > 100:
                    findings.append(Finding(
                        file=path, line=node.start_point[0] + 1,
                        rule_id="CP-JS-010", category=Category.complexity,
                        severity=Severity.high, confidence=Confidence.high,
                        title=f"Very long function ({length} lines)",
                        message=f"Function is {length} lines long (>100).",
                        why_it_matters="Very long functions are hard to maintain and test.",
                        suggested_fix="Break into smaller, focused functions.",
                        snippet="\n".join(lines[node.start_point[0]:node.start_point[0]+3]),
                    ))
                elif length > 50:
                    findings.append(Finding(
                        file=path, line=node.start_point[0] + 1,
                        rule_id="CP-JS-010", category=Category.complexity,
                        severity=Severity.medium, confidence=Confidence.high,
                        title=f"Long function ({length} lines)",
                        message=f"Function is {length} lines long (>50).",
                        why_it_matters="Long functions tend to do too much.",
                        suggested_fix="Consider splitting into smaller functions.",
                        snippet="\n".join(lines[node.start_point[0]:node.start_point[0]+3]),
                    ))

        # Call expressions — eval, document.write, etc.
        if node.type == "call_expression":
            func_text = node.children[0].text.decode() if node.children else ""
            lineno = node.start_point[0] + 1
            snippet = lines[node.start_point[0]] if node.start_point[0] < len(lines) else ""

            if func_text == "eval":
                findings.append(Finding(
                    file=path, line=lineno, rule_id="CP-JS-001",
                    category=Category.security, severity=Severity.critical,
                    confidence=Confidence.high,
                    title="Use of eval()", message="eval() called.",
                    why_it_matters="eval() executes arbitrary code.",
                    suggested_fix="Use JSON.parse() or a safer alternative.",
                    snippet=snippet.strip()[:120], cwe="CWE-95",
                ))
            elif func_text == "document.write":
                findings.append(Finding(
                    file=path, line=lineno, rule_id="CP-JS-005",
                    category=Category.security, severity=Severity.medium,
                    confidence=Confidence.high,
                    title="document.write()", message="document.write() called.",
                    why_it_matters="document.write() can introduce XSS.",
                    suggested_fix="Use DOM manipulation methods.",
                    snippet=snippet.strip()[:120], cwe="CWE-79",
                ))

        # Assignment: innerHTML
        if node.type == "assignment_expression":
            left = node.children[0] if node.children else None
            if left and left.type == "member_expression":
                prop = left.text.decode() if left.text else ""
                if ".innerHTML" in prop:
                    lineno = node.start_point[0] + 1
                    snippet = lines[node.start_point[0]] if node.start_point[0] < len(lines) else ""
                    findings.append(Finding(
                        file=path, line=lineno, rule_id="CP-JS-003",
                        category=Category.security, severity=Severity.high,
                        confidence=Confidence.medium,
                        title="innerHTML assignment", message="innerHTML set with potentially untrusted data.",
                        why_it_matters="Setting innerHTML with user data enables XSS.",
                        suggested_fix="Use textContent or sanitize with DOMPurify.",
                        snippet=snippet.strip()[:120], cwe="CWE-79",
                    ))

        # Empty catch blocks
        if node.type == "catch_clause":
            body = None
            for child in node.children:
                if child.type == "statement_block":
                    body = child
                    break
            if body and len([c for c in body.children if c.type not in ("{", "}", "comment")]) == 0:
                lineno = node.start_point[0] + 1
                snippet = lines[node.start_point[0]] if node.start_point[0] < len(lines) else ""
                findings.append(Finding(
                    file=path, line=lineno, rule_id="CP-JS-009",
                    category=Category.smell, severity=Severity.medium,
                    confidence=Confidence.high,
                    title="Empty catch block", message="Catch block is empty.",
                    why_it_matters="Empty catch blocks silently swallow errors.",
                    suggested_fix="Log the error or handle it appropriately.",
                    snippet=snippet.strip()[:120],
                ))

        for child in node.children:
            self._walk_ts(child, path, lines, findings)
