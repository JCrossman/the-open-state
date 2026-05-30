"""Tests for the MCP tool layer (server.py), run offline.

The tools are exercised with the mock-backed provider (same fixtures as the
provider tests). We check plain-language, screen-reader-friendly output, that
accessibility is surfaced, that failures are reported plainly, and - via one
in-memory MCP client call - that the tool schema coerces ISO date strings.
"""

from __future__ import annotations

import asyncio
import datetime as dt

import pytest

from open_state_camping import server
from open_state_camping.alerts import AlertStore

CAMPGROUND_ID = "-2147483644"
SITE_104 = "-2147475789"
START = dt.date(2026, 7, 17)
END = dt.date(2026, 7, 19)


@pytest.fixture
def tools(provider, tmp_path, monkeypatch):
    """Point the server's tools at the mock-backed provider and a temp store."""
    monkeypatch.setattr(server, "_provider", provider)
    monkeypatch.setattr(server, "_store", AlertStore(str(tmp_path / "alerts.db")))
    return server


def test_search_parks_lists_campgrounds_and_discloses_independence(tools):
    out = tools.search_parks.fn("Banff")
    assert CAMPGROUND_ID in out
    assert "not operated by or endorsed by Parks Canada" in out


def test_search_parks_no_match_is_friendly(tools):
    out = tools.search_parks.fn("Narnia")
    assert "could not find" in out.lower()


def test_list_equipment_types(tools):
    out = tools.list_equipment_types.fn("14")
    assert "equipment id:" in out


def test_search_sites_surfaces_accessibility_and_prepare_only(tools):
    out = tools.search_sites.fn(
        campground_id=CAMPGROUND_ID, start_date=START, end_date=END, party_size=2
    )
    assert "marked accessible" in out
    assert "create-booking/results" in out
    # Prepare-then-confirm is stated plainly (Constitution Art. 2).
    assert "never books" in out.lower()
    # No tables/emoji; simple dashed lines for screen readers.
    assert "\t" not in out


def test_search_sites_accessible_only(tools):
    out = tools.search_sites.fn(
        campground_id=CAMPGROUND_ID,
        start_date=START,
        end_date=END,
        party_size=2,
        accessible_only=True,
    )
    assert "accessible open site(s)" in out


def test_search_sites_no_results_suggests_alert(tools):
    out = tools.search_sites.fn(
        campground_id=CAMPGROUND_ID, start_date=START, end_date=END, party_size=99
    )
    assert "no open sites" in out.lower()
    assert "alert" in out.lower()


def test_search_sites_unknown_campground_is_friendly_not_raised(tools):
    out = tools.search_sites.fn(
        campground_id="-999999", start_date=START, end_date=END, party_size=2
    )
    assert "could not find" in out.lower()  # UpstreamError message, not a crash


def test_search_park_availability_consolidates_campgrounds(tools):
    out = tools.search_park_availability.fn(
        query="Banff", start_date=START, end_date=END, party_size=2
    )
    # One consolidated answer, with the independence disclaimer and a campground id
    # the citizen can hand to search_sites next.
    assert "not operated by or endorsed by Parks Canada" in out
    assert "campground id:" in out
    assert "open site(s)" in out
    # Steers to the per-campground search and stays prepare-only.
    assert "search_sites" in out and "never books" in out.lower()


def test_search_park_availability_unknown_park_is_friendly(tools):
    out = tools.search_park_availability.fn(
        query="Narnia", start_date=START, end_date=END, party_size=2
    )
    assert "could not find" in out.lower()


def test_search_park_availability_accepts_equipment_word(tools):
    # A plain word a citizen would say ("van") resolves to an id instead of
    # crashing the search (regression: int("van") used to raise per campground).
    out = tools.search_park_availability.fn(
        query="Banff", start_date=START, end_date=END, party_size=2,
        equipment_type="van",
    )
    assert "not operated by or endorsed by Parks Canada" in out
    assert "could not check" not in out.lower()


def test_search_park_availability_ambiguous_equipment_is_clear_not_masked(tools):
    # "tent" is ambiguous: the citizen gets the listed options, NOT a misleading
    # "could not check / no openings" that hides real availability.
    out = tools.search_park_availability.fn(
        query="Banff", start_date=START, end_date=END, party_size=2,
        equipment_type="tent",
    )
    assert "-32768" in out  # specific equipment options are named
    assert "could not check" not in out.lower()
    assert "no campgrounds" not in out.lower()


def test_search_park_availability_all_errored_does_not_claim_no_openings(
    tmp_path, monkeypatch
):
    """When no campground can be checked, we must not report 'no openings'.

    Regression for the bug where an upstream failure on every campground was
    rendered as 'No campgrounds have open sites' - implying we checked and found
    them full, when we have no availability data at all.
    """
    import json
    import pathlib

    import httpx

    from open_state_camping.config import Config
    from open_state_camping.providers.going_to_camp.client import GoingToCampClient
    from open_state_camping.providers.parks_canada import ParksCanadaProvider

    fixtures = pathlib.Path(__file__).parent / "fixtures" / "parks_canada"

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/availability/map":
            return httpx.Response(500, json={"error": "boom"})  # upstream down
        name = {
            "/api/resourceLocation": "resourceLocation_min.json",
            "/api/equipment": "equipment.json",
            "/api/resourcelocation/resources": "resources_min.json",
            "/api/attribute/filterable": "attribute_filterable_min.json",
        }.get(path)
        if name:
            return httpx.Response(200, json=json.loads((fixtures / name).read_text()))
        return httpx.Response(404, json={"error": path})

    client = GoingToCampClient(
        "reservation.pc.gc.ca",
        user_agent="test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    monkeypatch.setattr(
        server, "_provider", ParksCanadaProvider(client=client, config=Config())
    )

    out = server.search_park_availability.fn(
        query="Banff", start_date=START, end_date=END, party_size=2
    )
    lower = out.lower()
    assert "no openings" not in lower
    assert "no campgrounds i could check" not in lower
    assert "could not reach the booking system" in lower
    assert "could not check these" in lower  # unknown, not full


def test_get_site_details(tools):
    out = tools.get_site_details.fn(campground_id=CAMPGROUND_ID, campsite_id=SITE_104)
    assert "accessible" in out.lower()
    assert "Service type:" in out
    # Without include_photos, photos are offered as links, not fetched.
    assert "browser" in out.lower()


def test_get_site_details_returns_viewable_images(tools):
    from mcp.types import ImageContent, TextContent

    out = tools.get_site_details.fn(
        campground_id=CAMPGROUND_ID, campsite_id=SITE_104, include_photos=True
    )
    # Returns text plus viewable image content blocks the assistant can see.
    assert isinstance(out, list)
    text = next(b.text for b in out if isinstance(b, TextContent))
    images = [b for b in out if isinstance(b, ImageContent)]
    assert "Showing" in text and "photo" in text.lower()
    assert images, "expected at least one viewable image"
    assert len(images) <= 3  # capped
    assert all(b.mimeType.startswith("image/") for b in images)


def test_get_site_details_photo_load_failure_is_graceful(tools, monkeypatch):
    # If photos cannot be fetched, fall back to text + links, never error.
    monkeypatch.setattr(tools.get_provider(), "fetch_photo", lambda url: None)
    out = tools.get_site_details.fn(
        campground_id=CAMPGROUND_ID, campsite_id=SITE_104, include_photos=True
    )
    assert isinstance(out, str)
    assert "could not load" in out.lower()
    assert "reservation.pc.gc.ca/images/" in out


SMALL_TENT = "-32768"  # valid equipment id in the fixture


def test_prepare_booking_url_never_books(tools):
    out = tools.prepare_booking_url.fn(
        campground_id=CAMPGROUND_ID,
        campsite_id=SITE_104,
        start_date=START,
        end_date=END,
        party_size=2,
        equipment_type=SMALL_TENT,
    )
    assert "create-booking/results" in out
    assert "never books" in out.lower()
    # The chosen equipment is named back and threaded into the link.
    assert "Small Tent" in out
    assert "subEquipmentId=-32768" in out


def test_prepare_booking_url_requires_equipment(tools):
    out = tools.prepare_booking_url.fn(
        campground_id=CAMPGROUND_ID,
        campsite_id=SITE_104,
        start_date=START,
        end_date=END,
        party_size=2,
    )
    # No link; instead a prompt to choose equipment, with real options listed.
    assert "create-booking/results" not in out
    assert "requires it" in out.lower()
    assert "equipment id:" in out
    assert "Small Tent" in out


def test_prepare_booking_url_rejects_invalid_equipment(tools):
    out = tools.prepare_booking_url.fn(
        campground_id=CAMPGROUND_ID,
        campsite_id=SITE_104,
        start_date=START,
        end_date=END,
        party_size=2,
        equipment_type="999999",
    )
    assert "create-booking/results" not in out
    assert "not one Parks Canada offers" in out
    assert "equipment id:" in out


def test_end_to_end_via_mcp_client_coerces_iso_dates(tools):
    """Call through the in-memory MCP client with ISO strings (schema coercion)."""
    from fastmcp import Client

    async def _call():
        async with Client(server.mcp) as client:
            result = await client.call_tool(
                "search_sites",
                {
                    "campground_id": CAMPGROUND_ID,
                    "start_date": "2026-07-17",
                    "end_date": "2026-07-19",
                    "party_size": 2,
                },
            )
            return result

    result = asyncio.run(_call())
    text = result.content[0].text
    assert "open site(s)" in text
    assert "create-booking/results" in text
