"""AI explainer with Ollama + templated fallback.

Every rule has a built-in templated why_it_matters and suggested_fix
(always available, no AI needed).

Optional: calls local Ollama with the finding and a small code snippet
for a richer plain-language explanation. If Ollama is not running, returns
the templated explanation with ai: false.

Source code never leaves the machine.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import get_settings
from .models import Finding

log = logging.getLogger("codepulse.explain")


async def is_ollama_available() -> bool:
    """Check if the Ollama API is reachable."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{settings.ollama_url}/api/tags")
            return resp.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException, OSError):
        return False


def _build_prompt(finding: Finding) -> str:
    """Build a prompt for the Ollama model."""
    return (
        f"You are a code security and quality expert. Explain this finding to a developer "
        f"in plain language (2–3 sentences). Then suggest a fix with a short code snippet.\n\n"
        f"**Rule:** {finding.rule_id} ({finding.title})\n"
        f"**File:** {finding.file}:{finding.line}\n"
        f"**Message:** {finding.message}\n"
        f"**Code snippet:**\n```\n{finding.snippet}\n```\n\n"
        f"Respond in markdown with two sections: **Explanation** and **Suggested Fix**."
    )


async def explain_finding(finding: Finding) -> dict[str, Any]:
    """Return an explanation for the given finding.

    Tries Ollama first; falls back to the built-in template.
    """
    settings = get_settings()

    # Always have the templated response ready
    template_response = {
        "ai": False,
        "explanation": finding.why_it_matters or "No additional explanation available.",
        "suggested_fix": finding.suggested_fix or "No fix suggestion available.",
        "model": None,
    }

    # Try Ollama
    try:
        async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
            resp = await client.post(
                f"{settings.ollama_url}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": _build_prompt(finding),
                    "stream": False,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                ai_response = data.get("response", "")
                if ai_response.strip():
                    return {
                        "ai": True,
                        "explanation": ai_response,
                        "suggested_fix": finding.suggested_fix,
                        "model": settings.ollama_model,
                    }
    except (httpx.ConnectError, httpx.TimeoutException, OSError, Exception) as exc:
        log.debug("Ollama not available: %s", exc)

    return template_response
