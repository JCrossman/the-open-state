"""Tests for the M2 serving slice: storage backend seam, /health, and config.

All offline. The HTTP transport itself is exercised by a live smoke test, not in
CI (no network in CI).
"""

from __future__ import annotations

import asyncio

import pytest

from fastmcp import Client, FastMCP

from open_state_camping import server
from open_state_camping.alerts import AlertStore, build_store
from open_state_camping.config import Config, _env_bool


def test_build_store_selects_sqlite(tmp_path):
    store = build_store("sqlite", str(tmp_path / "a.db"))
    assert isinstance(store, AlertStore)


# -- read-only preview: alert tools are tag-gated -----------------------------


def test_alert_tools_are_tagged_for_exclusion():
    # The read-only preview hides these by the "alerts" tag, so they must carry it.
    for tool in (server.create_alert, server.list_alerts, server.delete_alert):
        assert "alerts" in tool.tags


def test_exclude_tags_hides_alert_tools():
    # Validate the FastMCP mechanism the preview relies on: exclude_tags filters
    # tagged tools out of both listing and calling.
    srv = FastMCP("t", exclude_tags={"alerts"})

    @srv.tool(tags={"alerts"})
    def watch() -> str:  # pragma: no cover - never exposed
        return "x"

    @srv.tool
    def search() -> str:
        return "y"

    async def list_names():
        async with Client(srv) as c:
            return sorted(t.name for t in await c.list_tools())

    assert asyncio.run(list_names()) == ["search"]


def test_config_reads_preview_env(monkeypatch):
    monkeypatch.setenv("OPEN_STATE_ENABLE_ALERTS", "false")
    monkeypatch.setenv("OPEN_STATE_RATE_LIMIT_RPS", "2.5")
    monkeypatch.setenv("OPEN_STATE_RATE_LIMIT_BURST", "7")
    cfg = Config.from_env()
    assert cfg.enable_alerts is False
    assert cfg.rate_limit_rps == 2.5
    assert cfg.rate_limit_burst == 7


def test_build_store_rejects_unknown_backend(tmp_path):
    with pytest.raises(ValueError, match="Unknown alert backend"):
        build_store("cosmos", str(tmp_path / "a.db"))


def test_health_route_reports_ok():
    resp = asyncio.run(server.health(None))
    assert resp.status_code == 200
    assert b'"status":"ok"' in resp.body.replace(b" ", b"")


def test_env_bool_parses_truthy_and_falsy(monkeypatch):
    monkeypatch.setenv("X", "true")
    assert _env_bool("X", False) is True
    monkeypatch.setenv("X", "0")
    assert _env_bool("X", True) is False
    monkeypatch.delenv("X", raising=False)
    assert _env_bool("X", True) is True  # default when unset


def test_config_reads_serving_env(monkeypatch):
    monkeypatch.setenv("OPEN_STATE_TRANSPORT", "http")
    monkeypatch.setenv("OPEN_STATE_HOST", "0.0.0.0")
    monkeypatch.setenv("OPEN_STATE_PORT", "9000")
    monkeypatch.setenv("OPEN_STATE_MCP_PATH", "/mcp")
    monkeypatch.setenv("OPEN_STATE_STATELESS_HTTP", "false")
    monkeypatch.setenv("OPEN_STATE_ALERT_BACKEND", "sqlite")
    cfg = Config.from_env()
    assert cfg.transport == "http"
    assert cfg.host == "0.0.0.0"
    assert cfg.port == 9000
    assert cfg.mcp_path == "/mcp"
    assert cfg.stateless_http is False
    assert cfg.alert_backend == "sqlite"
