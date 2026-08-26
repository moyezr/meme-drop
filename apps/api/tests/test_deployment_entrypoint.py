import json
import sys
import tomllib
from pathlib import Path

from fastapi import FastAPI

from app import app


def test_vercel_entrypoint_exports_fastapi_application() -> None:
    assert isinstance(app, FastAPI)
    assert app.title == "MemeDrop API"


def test_vercel_uses_automatic_root_entrypoint_detection() -> None:
    project_root = Path(__file__).parents[1]
    configuration = tomllib.loads((project_root / "pyproject.toml").read_text(encoding="utf-8"))

    assert "vercel" not in configuration.get("tool", {})
    assert (project_root / "app.py").is_file()
    assert str(project_root / "src") in sys.path


def test_vercel_crons_keep_trends_current_and_clean_generated_assets_daily() -> None:
    project_root = Path(__file__).parents[1]
    config = json.loads((project_root / "vercel.json").read_text(encoding="utf-8"))

    assert config["$schema"] == "https://openapi.vercel.sh/vercel.json"
    assert config["crons"] == [
        {"path": "/internal/cron/trends/refresh", "schedule": "0 2 * * *"},
        {"path": "/internal/cron/assets/cleanup", "schedule": "30 3 * * *"},
    ]
