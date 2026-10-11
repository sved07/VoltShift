"""Runtime configuration loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(__file__).resolve().parent / "data"

# Does not override variables that are already set in the process environment.
load_dotenv(BACKEND_DIR / ".env")

# gemini-2.5-flash (the original spec) is closed to new API users; override with GEMINI_MODEL.
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def _env_key(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None = field(default_factory=lambda: _env_key("GEMINI_API_KEY"))
    gemini_model: str = field(default_factory=lambda: _env_key("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL)
    electricity_maps_key: str | None = field(default_factory=lambda: _env_key("ELECTRICITY_MAPS_KEY"))
    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip() for o in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",") if o.strip()
        ]
    )


def get_settings() -> Settings:
    """Read settings fresh from the environment (cheap, and keeps tests isolated)."""
    return Settings()
