"""Test fixtures: serve recorded Parks Canada responses offline.

A MockTransport routes the GoingToCamp client's requests to JSON fixtures
captured from the live API (see docs/parks-canada-api-findings.md), so provider
and tool tests run with no live network calls (spec: "No live calls in CI").
"""

from __future__ import annotations

import json
import pathlib

import httpx
import pytest

from open_state_camping.config import Config
from open_state_camping.providers.going_to_camp.client import GoingToCampClient
from open_state_camping.providers.parks_canada import ParksCanadaProvider

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "parks_canada"

# Test campground: Banff - Tunnel Mountain Trailer Court.
CAMPGROUND_ID = "-2147483644"
ROOT_MAP_ID = "-2147483626"


def _load(name: str):
    return json.loads((FIXTURES / name).read_text())


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    params = dict(request.url.params)
    if path == "/api/resourceLocation":
        return httpx.Response(200, json=_load("resourceLocation_min.json"))
    if path == "/api/equipment":
        return httpx.Response(200, json=_load("equipment.json"))
    if path == "/api/resourcelocation/resources":
        return httpx.Response(200, json=_load("resources_min.json"))
    if path == "/api/availability/map":
        if params.get("mapId") == ROOT_MAP_ID:
            return httpx.Response(200, json=_load("availability_root.json"))
        return httpx.Response(200, json=_load("availability_child.json"))
    if path == "/api/attribute/filterable":
        return httpx.Response(200, json=_load("attribute_filterable_min.json"))
    return httpx.Response(404, json={"error": f"unexpected path {path}"})


@pytest.fixture
def mock_client() -> GoingToCampClient:
    transport = httpx.MockTransport(_handler)
    return GoingToCampClient(
        "reservation.pc.gc.ca",
        user_agent="test",
        http_client=httpx.Client(transport=transport),
    )


@pytest.fixture
def provider(mock_client: GoingToCampClient) -> ParksCanadaProvider:
    return ParksCanadaProvider(client=mock_client, config=Config())
