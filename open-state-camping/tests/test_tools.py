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


def test_prepare_booking_url_never_books(tools):
    out = tools.prepare_booking_url.fn(
        campground_id=CAMPGROUND_ID,
        campsite_id=SITE_104,
        start_date=START,
        end_date=END,
        party_size=2,
    )
    assert "create-booking/results" in out
    assert "never books" in out.lower()


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
