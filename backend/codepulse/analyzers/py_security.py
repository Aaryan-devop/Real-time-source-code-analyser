"""Python security analyzer using the AST module.

Each rule has a stable rule_id (CP-SEC-NNN) and, where applicable, a CWE reference.
Detection is AST-based, not just regex, for accuracy.
"""

from __future__ import annotations

import ast
import logging
from typing import Any

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity

log = logging.getLogger("codepulse.analyzers.py_security")


# ── Rule registry ──────────────────────────────────────────────────────
# Maps (rule_id, cwe, title, severity, confidence, why, fix)

RULES: dict[str, dict[str, Any]] = {
    "CP-SEC-001": {
        "title": "Use of eval()",
        "severity": Severity.critical, "confidence": Confidence.high,
        "cwe": "CWE-95",
        "why": "eval() executes arbitrary code. If the input is user-controlled, an attacker can run any Python code.",
        "fix": "Use ast.literal_eval() for safe literal parsing, or restructure so eval is not needed.",
    },
    "CP-SEC-002": {
        "title": "Use of exec()",
        "severity": Severity.critical, "confidence": Confidence.high,
        "cwe": "CWE-95",
        "why": "exec() executes arbitrary code strings. This is almost always a security risk.",
        "fix": "Find an alternative approach that doesn't require dynamic code execution.",
    },
    "CP-SEC-003": {
        "title": "Use of compile()",
        "severity": Severity.high, "confidence": Confidence.medium,
        "cwe": "CWE-95",
        "why": "compile() paired with exec/eval can execute arbitrary code.",
        "fix": "Avoid dynamically compiling code from untrusted sources.",
    },
    "CP-SEC-004": {
        "title": "Unsafe pickle deserialization",
        "severity": Severity.critical, "confidence": Confidence.high,
        "cwe": "CWE-502",
        "why": "pickle.load(s) can execute arbitrary code during deserialization. Never unpickle untrusted data.",
        "fix": "Use a safe serialization format like JSON. If pickle is necessary, only load from trusted sources.",
    },
    "CP-SEC-005": {
        "title": "Unsafe YAML loading",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-502",
        "why": "yaml.load() without SafeLoader can execute arbitrary Python objects during deserialization.",
        "fix": "Use yaml.safe_load() or yaml.load(data, Loader=yaml.SafeLoader).",
    },
    "CP-SEC-006": {
        "title": "Unsafe marshal deserialization",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-502",
        "why": "marshal.loads can execute code during deserialization of untrusted data.",
        "fix": "Use JSON or another safe format instead of marshal for untrusted data.",
    },
    "CP-SEC-007": {
        "title": "subprocess with shell=True",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-78",
        "why": "Using shell=True with subprocess allows shell injection if any part of the command comes from user input.",
        "fix": "Use a list of arguments without shell=True: subprocess.run(['cmd', 'arg1', 'arg2']).",
    },
    "CP-SEC-008": {
        "title": "Use of os.system()",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-78",
        "why": "os.system() executes a command through the shell, allowing shell injection.",
        "fix": "Use subprocess.run() with a list of arguments and shell=False.",
    },
    "CP-SEC-009": {
        "title": "Use of os.popen()",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-78",
        "why": "os.popen() runs a command through the shell, risking command injection.",
        "fix": "Use subprocess.run() with a list of arguments and shell=False.",
    },
    "CP-SEC-010": {
        "title": "SQL injection risk",
        "severity": Severity.critical, "confidence": Confidence.high,
        "cwe": "CWE-89",
        "why": "Building SQL queries with string formatting allows SQL injection attacks.",
        "fix": "Use parameterised queries: cursor.execute('SELECT * FROM t WHERE id=?', (user_id,)).",
    },
    "CP-SEC-011": {
        "title": "Weak hash for security",
        "severity": Severity.medium, "confidence": Confidence.medium,
        "cwe": "CWE-328",
        "why": "MD5 and SHA-1 are cryptographically broken and should not be used for passwords or security.",
        "fix": "Use hashlib.sha256() or better yet bcrypt/argon2 for passwords.",
    },
    "CP-SEC-012": {
        "title": "Insecure random for security",
        "severity": Severity.medium, "confidence": Confidence.medium,
        "cwe": "CWE-330",
        "why": "The random module is not cryptographically secure. Don't use it for tokens or secrets.",
        "fix": "Use the 'secrets' module: secrets.token_hex(), secrets.token_urlsafe().",
    },
    "CP-SEC-013": {
        "title": "SSL verification disabled",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-295",
        "why": "Disabling SSL verification makes connections vulnerable to man-in-the-middle attacks.",
        "fix": "Remove verify=False and use proper SSL certificates.",
    },
    "CP-SEC-014": {
        "title": "Debug mode enabled",
        "severity": Severity.medium, "confidence": Confidence.medium,
        "cwe": "CWE-489",
        "why": "Debug mode can expose stack traces and sensitive information to attackers.",
        "fix": "Set debug=False in production and use environment variables to control this.",
    },
    "CP-SEC-015": {
        "title": "Binding to 0.0.0.0",
        "severity": Severity.low, "confidence": Confidence.medium,
        "cwe": None,
        "why": "Binding to 0.0.0.0 exposes the server on all network interfaces.",
        "fix": "Bind to 127.0.0.1 for local-only access unless external access is intentional.",
    },
    "CP-SEC-016": {
        "title": "Use of tempfile.mktemp()",
        "severity": Severity.medium, "confidence": Confidence.high,
        "cwe": "CWE-377",
        "why": "tempfile.mktemp() is vulnerable to race conditions (symlink attacks).",
        "fix": "Use tempfile.mkstemp() or tempfile.NamedTemporaryFile() instead.",
    },
    "CP-SEC-017": {
        "title": "Assert used for security check",
        "severity": Severity.low, "confidence": Confidence.low,
        "cwe": "CWE-617",
        "why": "Assert statements are removed when Python runs with -O. They should not be used for security checks.",
        "fix": "Use an explicit if statement with a raise for security validations.",
    },
    "CP-SEC-018": {
        "title": "Unverified SSL context",
        "severity": Severity.high, "confidence": Confidence.high,
        "cwe": "CWE-295",
        "why": "Creating an unverified SSL context disables certificate validation.",
        "fix": "Use ssl.create_default_context() which validates certificates by default.",
    },
}


class PythonSecurityAnalyzer(Analyzer):
    name = "py_security"

    def supports(self, path: str) -> bool:
        return path.endswith(".py")

    def analyze(self, path: str, source: str) -> list[Finding]:
        findings: list[Finding] = []
        lines = source.splitlines()
        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError:
            return findings

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                findings.extend(self._check_call(path, lines, node, tree))
            elif isinstance(node, ast.Assert):
                findings.extend(self._check_assert(path, lines, node))

        return findings

    def _snippet(self, lines: list[str], lineno: int) -> str:
        idx = lineno - 1
        start = max(0, idx)
        end = min(len(lines), start + 3)
        return "\n".join(lines[start:end])

    def _make_finding(self, path: str, lines: list[str], lineno: int, rule_id: str, msg: str = "") -> Finding:
        rule = RULES[rule_id]
        return Finding(
            file=path, line=lineno, rule_id=rule_id,
            category=Category.security,
            severity=rule["severity"],
            confidence=rule["confidence"],
            title=rule["title"],
            message=msg or rule["title"],
            why_it_matters=rule["why"],
            suggested_fix=rule["fix"],
            snippet=self._snippet(lines, lineno),
            cwe=rule.get("cwe"),
        )

    def _check_call(self, path: str, lines: list[str], node: ast.Call, tree: ast.Module) -> list[Finding]:
        findings: list[Finding] = []
        func = node.func

        # ── Simple name calls: eval, exec, compile ──
        if isinstance(func, ast.Name):
            name = func.id

            if name == "eval":
                # Only flag if the argument is not a literal
                if node.args and not isinstance(node.args[0], ast.Constant):
                    findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-001",
                                                       "eval() called on non-literal input."))
            elif name == "exec":
                if node.args and not isinstance(node.args[0], ast.Constant):
                    findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-002",
                                                       "exec() called on non-literal input."))
            elif name == "compile":
                if node.args and not isinstance(node.args[0], ast.Constant):
                    findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-003",
                                                       "compile() called on non-literal input."))

        # ── Attribute calls: pickle.load, yaml.load, etc. ──
        elif isinstance(func, ast.Attribute):
            attr = func.attr
            obj = func.value

            # pickle.load / pickle.loads
            if attr in ("load", "loads") and isinstance(obj, ast.Name) and obj.id == "pickle":
                findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-004",
                                                   f"pickle.{attr}() used — unsafe deserialization."))

            # yaml.load without SafeLoader
            if attr == "load" and isinstance(obj, ast.Name) and obj.id == "yaml":
                safe = False
                for kw in node.keywords:
                    if kw.arg == "Loader" and isinstance(kw.value, ast.Attribute):
                        if "Safe" in kw.value.attr:
                            safe = True
                if not safe:
                    findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-005",
                                                       "yaml.load() without SafeLoader."))

            # marshal.loads
            if attr == "loads" and isinstance(obj, ast.Name) and obj.id == "marshal":
                findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-006",
                                                   "marshal.loads() used."))

            # subprocess with shell=True
            if attr in ("call", "run", "Popen", "check_output", "check_call"):
                if isinstance(obj, ast.Name) and obj.id == "subprocess":
                    for kw in node.keywords:
                        if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                            findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-007",
                                                               f"subprocess.{attr}() with shell=True."))

            # os.system / os.popen
            if isinstance(obj, ast.Name) and obj.id == "os":
                if attr == "system":
                    findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-008"))
                elif attr == "popen":
                    findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-009"))

            # SQL injection: .execute() with string formatting
            if attr == "execute":
                if node.args:
                    arg = node.args[0]
                    if isinstance(arg, ast.JoinedStr):  # f-string
                        findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-010",
                                                           "SQL query built with f-string."))
                    elif isinstance(arg, ast.BinOp) and isinstance(arg.op, (ast.Mod, ast.Add)):
                        findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-010",
                                                           "SQL query built with string formatting."))
                    elif isinstance(arg, ast.Call) and isinstance(arg.func, ast.Attribute) and arg.func.attr == "format":
                        findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-010",
                                                           "SQL query built with .format()."))

            # hashlib.md5 / sha1
            if isinstance(obj, ast.Name) and obj.id == "hashlib" and attr in ("md5", "sha1"):
                findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-011",
                                                   f"hashlib.{attr}() — weak hash."))

            # random used for security-sensitive operations
            if isinstance(obj, ast.Name) and obj.id == "random" and attr in ("random", "randint", "choice", "randrange"):
                findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-012",
                                                   f"random.{attr}() — not cryptographically secure."))

            # requests with verify=False
            if isinstance(obj, ast.Name) and obj.id == "requests" and attr in ("get", "post", "put", "delete", "patch"):
                for kw in node.keywords:
                    if kw.arg == "verify" and isinstance(kw.value, ast.Constant) and kw.value.value is False:
                        findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-013",
                                                           f"requests.{attr}() with verify=False."))

            # ssl._create_unverified_context
            if isinstance(obj, ast.Name) and obj.id == "ssl" and attr == "_create_unverified_context":
                findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-018",
                                                   "ssl._create_unverified_context() disables certificate validation."))

            # Flask/Django debug=True
            if attr == "run" and isinstance(obj, ast.Name):
                for kw in node.keywords:
                    if kw.arg == "debug" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                        findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-014",
                                                           "Application running with debug=True."))

            # Binding to 0.0.0.0
            if attr == "run" and isinstance(obj, ast.Name):
                for kw in node.keywords:
                    if kw.arg == "host" and isinstance(kw.value, ast.Constant) and kw.value.value == "0.0.0.0":
                        findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-015",
                                                           "Server binding to 0.0.0.0."))

            # tempfile.mktemp
            if isinstance(obj, ast.Name) and obj.id == "tempfile" and attr == "mktemp":
                findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-016",
                                                   "tempfile.mktemp() is insecure."))

        return findings

    def _check_assert(self, path: str, lines: list[str], node: ast.Assert) -> list[Finding]:
        """Flag assert statements that look like security checks."""
        findings: list[Finding] = []
        # Heuristic: look for auth/permission/role related words in the test
        src_line = lines[node.lineno - 1] if node.lineno <= len(lines) else ""
        security_words = ("auth", "permission", "role", "admin", "access", "token", "password")
        if any(w in src_line.lower() for w in security_words):
            findings.append(self._make_finding(path, lines, node.lineno, "CP-SEC-017",
                                               "Assert used for security validation."))
        return findings
