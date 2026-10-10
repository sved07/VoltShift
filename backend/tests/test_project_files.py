"""Spec: requirements.txt, .env.example and mock_iso_telemetry.json."""

import json
import re

from tests.conftest import BACKEND_DIR, ISO_IDS


def test_requirements_list_spec_packages():
    text = (BACKEND_DIR / "requirements.txt").read_text()
    for pkg in ("fastapi", "uvicorn[standard]", "pydantic", "google-genai", "python-dotenv", "httpx", "websockets"):
        assert pkg in text, pkg


def test_env_example_declares_keys_without_values():
    text = (BACKEND_DIR / ".env.example").read_text()
    for key in ("GEMINI_API_KEY", "ELECTRICITY_MAPS_KEY"):
        match = re.search(rf"^{key}=(.*)$", text, re.MULTILINE)
        assert match, key
        assert match.group(1).strip() == "", f"{key} must not ship with a value"


def test_mock_telemetry_covers_all_isos():
    data = json.loads((BACKEND_DIR / "app" / "data" / "mock_iso_telemetry.json").read_text())
    assert set(data["zones"]) == ISO_IDS
    for zone in data["zones"].values():
        assert zone["electricity_maps_zone"].startswith("US-")
