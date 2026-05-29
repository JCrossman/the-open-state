"""Parks Canada provider (wraps the GoingToCamp platform).

Implements the platform-agnostic :class:`CampingProvider` interface for Parks
Canada (`reservation.pc.gc.ca`). Tools call this through the interface and never
touch the GoingToCamp client directly, so a second provider (Alberta, M4) can be
added without changing tool code.

What it delivers, against the verified API (docs/parks-canada-api-findings.md):
per-campground availability for dates/equipment, **per-site accessibility**
(first-class, filterable — Constitution Art. 3), site names and capacity, and a
prepared booking deep link the citizen confirms themselves (Art. 2).

Known limits, flagged rather than guessed (Art. 7.1):
- Price is not exposed by the API; ``AvailableSite.price`` is ``None``.
- ``nights`` / ``weekends_only`` are accepted for interface compatibility but the
  M1 cut evaluates the explicit ``start_date``..``end_date`` window only.
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
    _attr_values,
    resource_is_accessible,
)

PARKS_CANADA_REC_AREA_ID = "14"
PARKS_CANADA_HOSTNAME = "reservation.pc.gc.ca"
PARKS_CANADA_NAME = "Parks Canada"


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
        self._service_type_labels: Optional[dict[int, str]] = None

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
        """Find open campsites in a Parks Canada campground for the stay."""
        root_map_id = self._root_map_id(campground_id)
        if root_map_id is None:
            raise UpstreamError(
                f"Could not find a Parks Canada campground with id {campground_id}."
            )
        equipment_id = int(equipment_type) if equipment_type is not None else None
        resources = self._client.get_resources(campground_id)
        available_ids = self._client.available_resource_ids(
            root_map_id=root_map_id,
            resource_location_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            equipment_id=equipment_id,
        )
        campground_name = self._campground_name(campground_id)
        booking_url = self._client.build_booking_url(
            map_id=root_map_id,
            resource_location_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            party_size=party_size,
            equipment_id=equipment_id,
        )
        dates = _nights(start_date, end_date)

        sites: list[AvailableSite] = []
        for resource_id in available_ids:
            resource = resources.get(resource_id)
            if resource is None:
                continue  # available id with no matching resource record; skip
            accessible = resource_is_accessible(resource)
            if accessible_only and not accessible:
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
                    available_dates=dates,
                    loop_name=None,
                    site_type=self._service_type_label(resource),
                    max_occupancy=resource.get("maxCapacity"),
                    price=None,  # not exposed by Parks Canada's API (flagged)
                    booking_url=booking_url,
                )
            )
        # Stable, helpful ordering: accessible sites first, then by name.
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
        photos = tuple(
            p.get("imageUrl") or p.get("url")
            for p in (resource.get("photos") or [])
            if isinstance(p, dict) and (p.get("imageUrl") or p.get("url"))
        )
        return SiteDetails(
            provider=self.name,
            recreation_area_id=str(recreation_area_id),
            campsite_id=str(campsite_id),
            site_name=_resource_name(resource) or str(campsite_id),
            accessible=accessible,
            description=None,
            amenities=(),
            accessibility_notes=tuple(notes),
            photos=photos,
            max_occupancy=resource.get("maxCapacity"),
            site_type=service_label,
        )

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

    def _service_type_label(self, resource: dict[str, Any]) -> Optional[str]:
        values = list(_attr_values(resource, SERVICE_TYPE_ATTR))
        if not values:
            return None
        labels = self._service_type_labels_map()
        for value in values:
            if value in labels:
                return labels[value]
        return None

    def _service_type_labels_map(self) -> dict[int, str]:
        if self._service_type_labels is None:
            self._service_type_labels = self._client.service_type_labels()
        return self._service_type_labels


def _resource_name(resource: dict[str, Any]) -> Optional[str]:
    localized = resource.get("localizedValues") or []
    return localized[0].get("name") if localized else None


def _nights(start_date: _dt.date, end_date: _dt.date) -> tuple[_dt.date, ...]:
    """Each night of the stay, from arrival up to (not including) departure."""
    count = (end_date - start_date).days
    if count <= 0:
        return (start_date,)
    return tuple(start_date + _dt.timedelta(days=i) for i in range(count))


def _name_sort_key(name: str) -> tuple[int, Any]:
    """Sort site names so numeric names order numerically, then text."""
    return (0, int(name)) if name.isdigit() else (1, name.lower())
