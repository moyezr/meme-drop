from __future__ import annotations

import runpy
from pathlib import Path

import httpx
import pytest


async def test_scenario_reset_recovers_exhausted_diagnostics_without_disabling_limits(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("MEMEDROP_BROWSER_FIXTURE", "1")
    monkeypatch.setenv("MEMEDROP_BROWSER_FIXTURE_PATH", str(tmp_path))
    fixture = runpy.run_path(str(Path(__file__).with_name("browser_fixture.py")))
    app = fixture["app"]
    app.state.settings.api_rate_limit_max = 3

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://browser-fixture"
    ) as client:
        for _ in range(3):
            assert (await client.get("/_fixture/state")).status_code == 200
        assert (await client.get("/_fixture/state")).status_code == 429

        assert (await client.post("/_fixture/reset")).status_code == 200
        state = await client.get("/_fixture/state")
        assert state.status_code == 200
        assert state.json()["suggestion_pending"] == 0

        # Production routes still consume and enforce their normal per-route limit.
        for _ in range(3):
            assert (await client.get("/api/v1/memes/browse")).status_code == 200
        assert (await client.get("/api/v1/memes/browse")).status_code == 429
