"""Parks Canada provider (wraps the GoingToCamp platform).

Implements the platform-agnostic :class:`CampingProvider` interface for Parks
Canada (`reservation.pc.gc.ca`). Tools call this through the interface and never
touch the GoingToCamp client directly, so a second provider (Alberta, M4) can be
added without changing tool code.

What it delivers, against the verified API (docs/parks-canada-api-findings.md):
per-campground availability evaluated per night (so ``nights`` and
``weekends_only`` work), filtering by party size, **per-site accessibility**
(first-class + ``accessible_only`` filter, Constitution Art. 3), site names,
capacity, plain-language service type and amenities, photos, and a prepared
booking deep link the citizen confirms themselves (Art. 2).

Known limits, flagged rather than guessed (Art. 7.1):
- Price is not exposed by the API (sites carry a ``feeScheduleId`` but no
  endpoint maps it to a dollar amount), so ``AvailableSite.price`` is ``None``.
- ``loop_name`` is not populated (the platform exposes loops as child maps; not
  wired in M1).
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Optional

from open_state_camping.config import Config
from open_state_camping.providers.base import (
    AvailableSite,
    Campground,
    CampingProvider,
    EquipmentType,
    RecreationArea,
    SiteDetails,
)
from open_state_camping.providers.going_to_camp.client import (
    SERVICE_TYPE_ATTR,
    GoingToCampClient,
    UpstreamError,
    localized,
    resource_is_accessible,
)

PARKS_CANADA_REC_AREA_ID = "14"
PARKS_CANADA_HOSTNAME = "reservation.pc.gc.ca"
PARKS_CANADA_NAME = "Parks Canada"

_FRIDAY, _SATURDAY = 4, 5


class ParksCanadaProvider(CampingProvider):
    """Parks Canada, via the GoingToCamp platform."""

    name = "parks_canada"

    def __init__(
        self,
        client: Optional[GoingToCampClient] = None,
        *,
        config: Optional[Config] = None,
    ) -> None:
        self._config = config or Config.from_env()
        self._client = client or GoingToCampClient(
            PARKS_CANADA_HOSTNAME,
            user_agent=self._config.user_agent,
            timeout=self._config.http_timeout_seconds,
        )
        self._campgrounds_cache: Optional[list[dict[str, Any]]] = None
        self._attr_defs_cache: Optional[dict[str, Any]] = None

    # -- interface ----------------------------------------------------------

    def search_parks(self, query: str, country: str = "CA") -> list[RecreationArea]:
        """Find Parks Canada campgrounds whose name matches a plain query.

        Parks Canada is a single recreation area on this platform; we return it
        with the campgrounds that match (so "Banff" surfaces the Banff
        campgrounds and their ids for the next call).
        """
        if country and country.upper() != "CA":
            return []
        needle = (query or "").strip().lower()
        broad = needle in ("", "parks canada", "canada", "parkscanada")
        matches = [
            c
            for c in self._campgrounds()
            if broad or needle in (c["name"] or "").lower()
        ]
        campgrounds = tuple(
            Campground(
                provider=self.name,
                recreation_area_id=PARKS_CANADA_REC_AREA_ID,
                campground_id=str(c["resource_location_id"]),
                name=c["name"] or "",
            )
            for c in matches
        )
        return [
            RecreationArea(
                provider=self.name,
                recreation_area_id=PARKS_CANADA_REC_AREA_ID,
                name=PARKS_CANADA_NAME,
                description=(
                    "Campgrounds in Canada's national parks, booked through "
                    "the Parks Canada reservation service."
                ),
                campgrounds=campgrounds,
            )
        ]

    def list_equipment_types(self, recreation_area_id: str) -> list[EquipmentType]:
        """List equipment types valid for Parks Canada bookings."""
        return [
            EquipmentType(
                provider=self.name,
                recreation_area_id=str(recreation_area_id),
                equipment_id=str(t["equipment_id"]),
                name=t["name"] or "",
            )
            for t in self._client.list_equipment_types()
        ]

    def search_sites(
        self,
        *,
        recreation_area_id: str,
        campground_id: str,
        start_date: _dt.date,
        end_date: _dt.date,
        party_size: int,
        equipment_type: Optional[str] = None,
        accessible_only: bool = False,
        nights: Optional[int] = None,
        weekends_only: bool = False,
    ) -> list[AvailableSite]:
        """Find open campsites in a Parks Canada campground for the stay.

        Availability is evaluated per night from the platform's daily data:
        - default: the site must be open for every night of the stay;
        - ``nights=N``: the site must have a run of at least N consecutive open
          nights within the window;
        - ``weekends_only``: the Friday/Saturday nights in the window must be open.
        Sites that cannot hold ``party_size`` are excluded, as are non-accessible
        sites when ``accessible_only`` is set.
        """
        root_map_id = self._root_map_id(campground_id)
        if root_map_id is None:
            raise UpstreamError(
                f"Could not find a Parks Canada campground with id {campground_id}."
            )
        equipment_id = int(equipment_type) if equipment_type is not None else None
        resources = self._client.get_resources(campground_id)
        daily = self._client.daily_availability(
            root_map_id=root_map_id,
            resource_location_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            equipment_id=equipment_id,
        )
        window_nights = _window_nights(start_date, end_date)
        campground_name = self._campground_name(campground_id)
        booking_url = self._client.build_booking_url(
            map_id=root_map_id,
            resource_location_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            party_size=party_size,
            equipment_id=equipment_id,
        )

        sites: list[AvailableSite] = []
        for resource_id, day_codes in daily.items():
            resource = resources.get(resource_id)
            if resource is None:
                continue
            open_nights = _open_nights(window_nights, day_codes)
            qualifies, available_dates = _evaluate_stay(
                open_nights, window_nights, nights, weekends_only
            )
            if not qualifies:
                continue
            accessible = resource_is_accessible(resource)
            if accessible_only and not accessible:
                continue
            max_occupancy = resource.get("maxCapacity")
            if party_size and max_occupancy is not None and max_occupancy < party_size:
                continue
            sites.append(
                AvailableSite(
                    provider=self.name,
                    recreation_area=PARKS_CANADA_NAME,
                    recreation_area_id=PARKS_CANADA_REC_AREA_ID,
                    campground=campground_name,
                    campground_id=str(campground_id),
                    campsite_id=resource_id,
                    site_name=_resource_name(resource) or resource_id,
                    accessible=accessible,
                    available_dates=tuple(available_dates),
                    loop_name=None,
                    site_type=self._service_type_label(resource),
                    max_occupancy=max_occupancy,
                    price=None,  # not exposed by Parks Canada's API (flagged)
                    booking_url=booking_url,
                )
            )
        sites.sort(key=lambda s: (not s.accessible, _name_sort_key(s.site_name)))
        return sites

    def site_details(
        self,
        *,
        recreation_area_id: str,
        campground_id: str,
        campsite_id: str,
    ) -> SiteDetails:
        """Get plain-language detail for one Parks Canada campsite."""
        resources = self._client.get_resources(campground_id)
        resource = resources.get(str(campsite_id))
        if resource is None:
            raise UpstreamError(
                f"Could not find campsite {campsite_id} in campground {campground_id}."
            )
        accessible = resource_is_accessible(resource)
        notes: list[str] = []
        if accessible:
            notes.append("Parks Canada marks this site as accessible.")
        service_label = self._service_type_label(resource)
        if service_label:
            notes.append(f"Service type: {service_label}.")
        return SiteDetails(
            provider=self.name,
            recreation_area_id=str(recreation_area_id),
            campsite_id=str(campsite_id),
            site_name=_resource_name(resource) or str(campsite_id),
            accessible=accessible,
            description=None,
            amenities=self._amenities(resource),
            accessibility_notes=tuple(notes),
            photos=_photos(resource),
            max_occupancy=resource.get("maxCapacity"),
            site_type=service_label,
        )

    def fetch_photo(self, url: str) -> Optional[tuple[bytes, str]]:
        """Fetch one site photo as (bytes, format), or None if it cannot load."""
        return self._client.fetch_image(url)

    def booking_url(
        self,
        *,
        recreation_area_id: str,
        campground_id: str,
        campsite_id: str,
        start_date: _dt.date,
        end_date: _dt.date,
        party_size: int,
        equipment_type: Optional[str] = None,
    ) -> str:
        """Build the campground-level booking deep link (never books)."""
        root_map_id = self._root_map_id(campground_id)
        if root_map_id is None:
            raise UpstreamError(
                f"Could not find a Parks Canada campground with id {campground_id}."
            )
        equipment_id = int(equipment_type) if equipment_type is not None else None
        return self._client.build_booking_url(
            map_id=root_map_id,
            resource_location_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            party_size=party_size,
            equipment_id=equipment_id,
        )

    # -- helpers ------------------------------------------------------------

    def _campgrounds(self) -> list[dict[str, Any]]:
        if self._campgrounds_cache is None:
            self._campgrounds_cache = self._client.list_campgrounds()
        return self._campgrounds_cache

    def _find_campground(self, campground_id: str) -> Optional[dict[str, Any]]:
        target = str(campground_id)
        for c in self._campgrounds():
            if str(c["resource_location_id"]) == target:
                return c
        return None

    def _root_map_id(self, campground_id: str) -> Optional[int]:
        c = self._find_campground(campground_id)
        return c["root_map_id"] if c else None

    def _campground_name(self, campground_id: str) -> str:
        c = self._find_campground(campground_id)
        return (c["name"] if c else None) or str(campground_id)

    def _attr_defs(self) -> dict[str, Any]:
        if self._attr_defs_cache is None:
            self._attr_defs_cache = self._client.attribute_definitions()
        return self._attr_defs_cache

    def _service_type_label(self, resource: dict[str, Any]) -> Optional[str]:
        labels = _enum_labels(self._attr_defs(), SERVICE_TYPE_ATTR)
        for value in _attr_values(resource, SERVICE_TYPE_ATTR):
            if value in labels:
                return labels[value]
        return None

    def _amenities(self, resource: dict[str, Any]) -> tuple[str, ...]:
        """Describe every defined attribute in plain language, e.g.
        "Accessible: Yes", "Service Type: Electricity with on-site Fire Pit"."""
        defs = self._attr_defs()
        amenities: list[str] = []
        for attribute in resource.get("definedAttributes") or []:
            definition = defs.get(str(attribute.get("attributeDefinitionId")))
            if not definition:
                continue
            name = _display_name(definition)
            if not name:
                continue
            enum_labels = _enum_labels_from_def(definition)
            values = attribute.get("values")
            if values is None and attribute.get("value") is not None:
                values = [attribute["value"]]
            labels = [str(enum_labels.get(v, v)) for v in (values or [])]
            labels = [label for label in labels if label]
            if labels:
                amenities.append(f"{name}: {', '.join(labels)}")
        return tuple(amenities)


# -- module-level pure helpers ---------------------------------------------


def _resource_name(resource: dict[str, Any]) -> Optional[str]:
    return localized(resource.get("localizedValues"), "name")


def _photos(resource: dict[str, Any]) -> tuple[str, ...]:
    """Extract usable photo URLs (real shape: photos[].photoUrlResult.url)."""
    urls: list[str] = []
    for photo in resource.get("photos") or []:
        result = (photo or {}).get("photoUrlResult") or {}
        url = result.get("url") or result.get("avifUrl")
        if url:
            urls.append(url)
    return tuple(urls)


def _attr_values(resource: dict[str, Any], attribute_id: int) -> list[int]:
    for attribute in resource.get("definedAttributes") or []:
        if attribute.get("attributeDefinitionId") == attribute_id:
            values = attribute.get("values")
            if values is None and attribute.get("value") is not None:
                values = [attribute["value"]]
            return list(values or [])
    return []


def _display_name(definition: dict[str, Any]) -> Optional[str]:
    return localized(definition.get("localizedValues"), "displayName")


def _enum_labels_from_def(definition: dict[str, Any]) -> dict[int, str]:
    labels: dict[int, str] = {}
    for value in definition.get("values") or []:
        enum_value = value.get("enumValue")
        if enum_value is not None:
            labels[enum_value] = localized(value.get("localizedValues"), "displayName")
    return labels


def _enum_labels(defs: dict[str, Any], attribute_id: int) -> dict[int, str]:
    definition = defs.get(str(attribute_id))
    return _enum_labels_from_def(definition) if definition else {}


def _window_nights(start_date: _dt.date, end_date: _dt.date) -> list[_dt.date]:
    """The nights of the stay: arrival up to (not including) departure."""
    count = (end_date - start_date).days
    if count <= 0:
        return [start_date]
    return [start_date + _dt.timedelta(days=i) for i in range(count)]


def _open_nights(
    window_nights: list[_dt.date], day_codes: list[Optional[int]]
) -> list[_dt.date]:
    """Nights in the window the platform reports as open (code 0)."""
    return [
        night
        for index, night in enumerate(window_nights)
        if index < len(day_codes) and day_codes[index] == 0
    ]


def _evaluate_stay(
    open_nights: list[_dt.date],
    window_nights: list[_dt.date],
    nights: Optional[int],
    weekends_only: bool,
) -> tuple[bool, list[_dt.date]]:
    """Decide if a site qualifies, and which nights justify it."""
    open_set = set(open_nights)
    if weekends_only:
        weekend = [n for n in window_nights if n.weekday() in (_FRIDAY, _SATURDAY)]
        if weekend and all(n in open_set for n in weekend):
            return True, weekend
        return False, []
    if nights and nights > 0:
        best: list[_dt.date] = []
        run: list[_dt.date] = []
        for night in window_nights:
            run = run + [night] if night in open_set else []
            if len(run) > len(best):
                best = run
        if len(best) >= nights:
            return True, best
        return False, []
    if window_nights and all(n in open_set for n in window_nights):
        return True, list(window_nights)
    return False, []


def _name_sort_key(name: str) -> tuple[int, Any]:
    """Sort site names so numeric names order numerically, then text."""
    return (0, int(name)) if name.isdigit() else (1, name.lower())
