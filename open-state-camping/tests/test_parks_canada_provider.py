"""Tests for ParksCanadaProvider, run offline against recorded fixtures.

These verify the provider maps the verified Parks Canada API into the normalized
CampingProvider shapes, including per-night availability (nights / weekends_only),
party-size filtering, and accessibility (Constitution Art. 3).
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

# Fixture sites (availability_child.json):
SITE_104 = "-2147475789"  # accessible; open both nights
SITE_403 = "-2147475943"  # open both nights
SITE_101 = "-2147475657"  # open night 0 only
# (105 and 112 are closed.)

START = dt.date(2026, 7, 17)
END = dt.date(2026, 7, 19)  # 2-night stay: nights of 07-17 and 07-18


def _search(provider, **overrides):
    kwargs = dict(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        start_date=START,
        end_date=END,
        party_size=2,
    )
    kwargs.update(overrides)
    return provider.search_sites(**kwargs)


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


def test_default_search_requires_whole_stay_open(provider: ParksCanadaProvider):
    # Only sites open for BOTH nights qualify (101 is open one night only).
    sites = _search(provider)
    assert [s.campsite_id for s in sites] == [SITE_104, SITE_403]
    assert all(isinstance(s, AvailableSite) for s in sites)

    site = sites[0]
    assert site.campsite_id == SITE_104  # accessible sorts first
    assert site.accessible is True
    assert site.recreation_area == "Parks Canada"
    assert site.max_occupancy == 6
    assert site.available_dates == (START, dt.date(2026, 7, 18))  # both nights
    assert site.price is None  # not exposed by the API; flagged, not guessed
    assert "create-booking/results" in site.booking_url
    assert site.site_type and "Accessible" in site.site_type


def test_accessible_only_filters(provider: ParksCanadaProvider):
    sites = _search(provider, accessible_only=True)
    assert [s.campsite_id for s in sites] == [SITE_104]
    assert all(s.accessible for s in sites)


def test_nights_filter_accepts_partial_runs(provider: ParksCanadaProvider):
    # nights=1: a single open night is enough, so the one-night site qualifies.
    sites = _search(provider, nights=1)
    assert {s.campsite_id for s in sites} == {SITE_104, SITE_403, SITE_101}
    one_night = next(s for s in sites if s.campsite_id == SITE_101)
    assert one_night.available_dates == (START,)  # only 07-17 is open


def test_weekends_only(provider: ParksCanadaProvider):
    # A Friday->Sunday window: both nights are weekend nights.
    friday = START + dt.timedelta(days=(4 - START.weekday()) % 7)
    sites = _search(provider, start_date=friday, end_date=friday + dt.timedelta(days=2),
                    weekends_only=True)
    # 104 and 403 are open both nights; 101 misses the Saturday night.
    assert {s.campsite_id for s in sites} == {SITE_104, SITE_403}


def test_party_size_excludes_too_small_sites(provider: ParksCanadaProvider):
    # Fixture sites hold up to 6; a party of 8 fits none.
    assert _search(provider, party_size=8) == []


def test_search_sites_unknown_campground_fails_visibly(provider: ParksCanadaProvider):
    with pytest.raises(UpstreamError):
        _search(provider, campground_id="-999999")


def test_booking_url_is_campground_level_and_never_books(provider: ParksCanadaProvider):
    url = provider.booking_url(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        campsite_id=SITE_104,
        start_date=START,
        end_date=END,
        party_size=2,
    )
    assert url.startswith("https://reservation.pc.gc.ca/create-booking/results")
    assert f"mapId={ROOT_MAP_ID}" in url
    assert f"resourceLocationId={CAMPGROUND_ID}" in url
    assert "startDate=2026-07-17" in url and "endDate=2026-07-19" in url


def test_site_details_includes_accessibility_amenities_and_photos(
    provider: ParksCanadaProvider,
):
    details = provider.site_details(
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        campsite_id=SITE_104,
    )
    assert details.accessible is True
    assert any("accessible" in note.lower() for note in details.accessibility_notes)
    assert details.max_occupancy == 6
    # Amenities described in plain language from the attribute dictionary.
    assert any(a.startswith("Accessible:") for a in details.amenities)
    assert any(a.startswith("Service Type:") for a in details.amenities)
    # Photos use the real shape (photos[].photoUrlResult.url).
    assert details.photos and all(u.startswith("http") for u in details.photos)


def test_fetch_photo_returns_image_bytes(provider: ParksCanadaProvider):
    details = provider.site_details(
        recreation_area_id="14", campground_id=CAMPGROUND_ID, campsite_id=SITE_104
    )
    fetched = provider.fetch_photo(details.photos[0])
    assert fetched is not None
    data, fmt = fetched
    assert data.startswith(b"\xff\xd8")  # JPEG magic
    assert fmt == "jpeg"


def test_fetch_photo_rejects_offsite_urls(provider: ParksCanadaProvider):
    # SSRF guard: only this platform's own https image host is fetched.
    assert provider.fetch_photo("http://reservation.pc.gc.ca/images/x.jpg") is None
    assert provider.fetch_photo("https://evil.example.com/x.jpg") is None
    assert provider.fetch_photo("https://169.254.169.254/latest/meta-data") is None


def test_search_park_availability_covers_all_matching_campgrounds(
    provider: ParksCanadaProvider,
):
    results = provider.search_park_availability(
        query="Banff", start_date=START, end_date=END, party_size=2
    )
    # Both Banff campgrounds in the fixture are checked in one call.
    names = {r.campground_name for r in results}
    assert "Banff - Tunnel Mountain Trailer Court" in names
    assert "Banff - Two Jack Lakeside" in names
    # The campground with fixture availability reports open sites.
    main = next(r for r in results if r.campground_id == CAMPGROUND_ID)
    assert main.open_site_count > 0
    assert main.error is None
    # Results are sorted with the most-open campgrounds first.
    counts = [r.open_site_count for r in results if r.error is None]
    assert counts == sorted(counts, reverse=True)


def test_resource_is_accessible_reads_attribute_minus_32756():
    assert resource_is_accessible(
        {"definedAttributes": [{"attributeDefinitionId": -32756, "values": [0]}]}
    )
    assert not resource_is_accessible(
        {"definedAttributes": [{"attributeDefinitionId": -32756, "values": [1]}]}
    )
    assert not resource_is_accessible({"definedAttributes": []})
