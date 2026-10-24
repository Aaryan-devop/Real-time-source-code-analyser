"""Environment-driven configuration for CodePulse."""

from __future__ import annotations

import os
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """All configuration is driven by environment variables (with sensible defaults)."""

    # Server
    host: str = Field(default="127.0.0.1", alias="CODEPULSE_HOST")
    port: int = Field(default=8000, alias="CODEPULSE_PORT")

    # Watcher
    debounce_ms: int = Field(default=300, alias="CODEPULSE_DEBOUNCE_MS")
    max_file_size_kb: int = Field(default=1024, alias="CODEPULSE_MAX_FILE_SIZE_KB")
    ignore_patterns: str = Field(
        default=".git,node_modules,__pycache__,venv,.venv,dist,build,.idea,.vscode",
        alias="CODEPULSE_IGNORE_PATTERNS",
    )

    # Health score weights
    weight_critical: float = Field(default=10.0, alias="CODEPULSE_WEIGHT_CRITICAL")
    weight_high: float = Field(default=5.0, alias="CODEPULSE_WEIGHT_HIGH")
    weight_medium: float = Field(default=2.0, alias="CODEPULSE_WEIGHT_MEDIUM")
    weight_low: float = Field(default=0.5, alias="CODEPULSE_WEIGHT_LOW")
    weight_info: float = Field(default=0.0, alias="CODEPULSE_WEIGHT_INFO")

    # Ollama
    ollama_url: str = Field(default="http://localhost:11434", alias="CODEPULSE_OLLAMA_URL")
    ollama_model: str = Field(default="qwen2.5-coder:1.5b", alias="CODEPULSE_OLLAMA_MODEL")
    ollama_timeout: int = Field(default=15, alias="CODEPULSE_OLLAMA_TIMEOUT")

    # CORS
    cors_origin: str = Field(default="http://localhost:5173", alias="CODEPULSE_CORS_ORIGIN")

    @property
    def ignore_list(self) -> list[str]:
        """Return ignore patterns as a list."""
        return [p.strip() for p in self.ignore_patterns.split(",") if p.strip()]

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_kb * 1024

    @property
    def severity_weights(self) -> dict[str, float]:
        return {
            "critical": self.weight_critical,
            "high": self.weight_high,
            "medium": self.weight_medium,
            "low": self.weight_low,
            "info": self.weight_info,
        }

    model_config = {"env_file": ".env", "extra": "ignore", "populate_by_name": True}


# Singleton
_settings: Settings | None = None


def get_settings() -> Settings:
    """Return the global settings singleton."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


# Base paths
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = Path(__file__).resolve().parent / "data"
SAMPLES_DIR = BACKEND_DIR / "samples" / "demo_project"
