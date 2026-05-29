"""Tests for ParksCanadaProvider, run offline against recorded fixtures.

These verify the provider maps the verified Parks Canada API into the normalized
CampingProvider shapes, and that accessibility (Constitution Art. 3) is read and
filtered correctly.
"""

from __future__ import annotations

import datetime as dt

import pytest

from open_state_camping.providers import (
    AvailableSite,
    CampingProvider,
    ParksCanadaProvider,
)
from open_state_camping.providers.going_to_camp.client import (
    UpstreamError,
    resource_is_accessible,
)

# Test campground: Banff - Tunnel Mountain Trailer Court (see conftest).
CAMPGROUND_ID = "-2147483644"
ROOT_MAP_ID = "-2147483626"

START = dt.date(2026, 7, 17)
END = dt.date(2026, 7, 19)

# From the curated fixtures: among the open sites, only "104" is accessible.
ACCESSIBLE_SITE_ID = "-2147475789"   # site "104"
OPEN_SITE_IDS = {"-2147475657", "-2147475789", "-2147475943"}  # 101, 104, 403


def test_provider_implements_interface(provider: ParksCanadaProvider):
    assert isinstance(provider, CampingProvider)
    assert provider.name == "parks_canada"


def test_search_parks_resolves_campgrounds(provider: ParksCanadaProvider):
    areas = provider.search_parks("Banff")
    assert len(areas) == 1
    area = areas[0]
    assert area.recreation_area_id == "14"
    ids = {c.campground_id for c in area.campgrounds}
    assert CAMPGROUND_ID in ids
    banff = next(c for c in area.campgrounds if c.campground_id == CAMPGROUND_ID)
    assert "Banff" in banff.name


def test_search_parks_non_canada_is_empty(provider: ParksCanadaProvider):
    assert provider.search_parks("anything", country="US") == []


def test_list_equipment_types(provider: ParksCanadaProvider):
    types = provider.list_equipment_types("14")
    assert types, "expected at least one equipment type"
    assert all(t.equipment_id and t.name for t in types)


def test_search_sites_returns_open_sites_with_accessibility(provider: ParksCanadaProvider):
    sites = provider.search_sites(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        start_date=START,
        end_date=END,
        party_size=2,
    )
    assert {s.campsite_id for s in sites} == OPEN_SITE_IDS
    assert all(isinstance(s, AvailableSite) for s in sites)

    # Accessibility is first-class and correct.
    accessible = [s for s in sites if s.accessible]
    assert [s.campsite_id for s in accessible] == [ACCESSIBLE_SITE_ID]
    # Accessible sites sort first.
    assert sites[0].campsite_id == ACCESSIBLE_SITE_ID

    site = accessible[0]
    assert site.recreation_area == "Parks Canada"
    assert site.campground_id == CAMPGROUND_ID
    assert site.max_occupancy is not None
    assert site.available_dates == (START, dt.date(2026, 7, 18))  # 2 nights
    assert site.price is None  # not exposed by the API; flagged, not guessed
    assert "create-booking/results" in site.booking_url
    assert site.site_type and "Accessible" in site.site_type


def test_accessible_only_filters(provider: ParksCanadaProvider):
    sites = provider.search_sites(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        start_date=START,
        end_date=END,
        party_size=2,
        accessible_only=True,
    )
    assert [s.campsite_id for s in sites] == [ACCESSIBLE_SITE_ID]
    assert all(s.accessible for s in sites)


def test_search_sites_unknown_campground_fails_visibly(provider: ParksCanadaProvider):
    with pytest.raises(UpstreamError):
        provider.search_sites(
            recreation_area_id="14",
            campground_id="-999999",
            start_date=START,
            end_date=END,
            party_size=2,
        )


def test_booking_url_is_campground_level_and_never_books(provider: ParksCanadaProvider):
    url = provider.booking_url(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        campsite_id=ACCESSIBLE_SITE_ID,
        start_date=START,
        end_date=END,
        party_size=2,
    )
    assert url.startswith("https://reservation.pc.gc.ca/create-booking/results")
    assert f"mapId={ROOT_MAP_ID}" in url
    assert f"resourceLocationId={CAMPGROUND_ID}" in url
    assert "startDate=2026-07-17" in url and "endDate=2026-07-19" in url


def test_site_details_includes_accessibility_notes(provider: ParksCanadaProvider):
    details = provider.site_details(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        campsite_id=ACCESSIBLE_SITE_ID,
    )
    assert details.accessible is True
    assert any("accessible" in note.lower() for note in details.accessibility_notes)
    assert details.max_occupancy is not None


def test_resource_is_accessible_reads_attribute_minus_32756():
    assert resource_is_accessible(
        {"definedAttributes": [{"attributeDefinitionId": -32756, "values": [0]}]}
    )
    assert not resource_is_accessible(
        {"definedAttributes": [{"attributeDefinitionId": -32756, "values": [1]}]}
    )
    assert not resource_is_accessible({"definedAttributes": []})
