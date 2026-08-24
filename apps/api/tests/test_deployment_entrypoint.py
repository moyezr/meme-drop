import json
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


def test_vercel_cron_uses_the_protected_four_hour_trend_refresh_route() -> None:
    project_root = Path(__file__).parents[1]
    config = json.loads((project_root / "vercel.json").read_text(encoding="utf-8"))

    assert config["$schema"] == "https://openapi.vercel.sh/vercel.json"
    assert config["crons"] == [
        {"path": "/internal/cron/trends/refresh", "schedule": "0 */4 * * *"}
    ]
