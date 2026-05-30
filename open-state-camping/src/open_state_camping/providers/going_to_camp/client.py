"""Thin HTTP client for the GoingToCamp / Camis platform (Parks Canada).

Implements the endpoint contract verified live in
docs/parks-canada-api-findings.md. This client only *reads* public availability
and resource data and *builds* a booking deep link the citizen confirms
themselves. It never logs in, books, pays, or handles citizen credentials
(Constitution Articles 1 and 2).

Failures are surfaced as typed errors so callers can fail visibly rather than
guess (Constitution Art. 7.2).
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Iterable, Optional

import httpx

from open_state_camping.tls import verify_setting

# --- Platform constants (verified against the live API) ---------------------

# Resource categories that represent reservable campsites.
CAMP_SITE = -2147483648
OVERFLOW_SITE = -2147483647
GROUP_SITE = -2147483643
CAMPSITE_CATEGORIES = frozenset({CAMP_SITE, OVERFLOW_SITE, GROUP_SITE})

# The non-group equipment category id used by the availability and booking calls.
NON_GROUP_EQUIPMENT = -32768

# Attribute definitions used for accessibility (see findings doc).
ACCESSIBLE_ATTR = -32756        # value 0 = Yes (accessible), 1 = No
SERVICE_TYPE_ATTR = -32768      # some enum values are "Accessible, ..."

# Recursion safety: a single campground search should never fan out beyond this
# many map requests (politeness + loop guard).
_MAX_MAP_REQUESTS = 50


def localized(
    values: Optional[list[dict[str, Any]]],
    field: str,
    prefer: tuple[str, ...] = ("en-CA", "en-US", "en"),
) -> Any:
    """Pull a field from a localizedValues list, preferring English.

    Parks Canada returns both English and French entries; outputs are read by
    citizens who may use a screen reader in English, so we surface the English
    text (Constitution Art. 3.2), falling back to whatever is present.
    """
    values = values or []
    for culture in prefer:
        for value in values:
            if value.get("cultureName") == culture:
                return value.get(field)
    return values[0].get(field) if values else None


class UpstreamError(RuntimeError):
    """The booking platform returned an error or unusable response."""


class QueueItError(UpstreamError):
    """The platform is gating traffic through a Queue-it virtual waiting room.

    On launch days both Parks Canada and Alberta use Queue-it. We never try to
    defeat it; we detect it and surface it as a clear status so the citizen
    knows to wait (docs/01-architecture.md "Upstream politeness").
    """


class GoingToCampClient:
    """Read-only client for one GoingToCamp host (e.g. reservation.pc.gc.ca)."""

    def __init__(
        self,
        hostname: str,
        *,
        user_agent: str,
        timeout: float = 30.0,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        self.hostname = hostname
        self._base = f"https://{hostname}"
        # An injected client (e.g. with a MockTransport) makes the provider
        # fully testable offline, with no live network calls in CI.
        self._client = http_client or httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            verify=verify_setting(),
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-CA,en;q=0.9",
                "Referer": f"{self._base}/",
            },
        )

    # -- low-level ----------------------------------------------------------

    def _get(self, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        try:
            resp = self._client.get(f"{self._base}{path}", params=params)
        except httpx.HTTPError as exc:  # network/timeout
            raise UpstreamError(
                f"Could not reach the Parks Canada booking system ({exc})."
            ) from exc

        # Queue-it sends the browser to a *.queue-it.net waiting room.
        if "queue-it.net" in str(resp.url):
            raise QueueItError(
                "Parks Canada is using a virtual waiting room right now. "
                "Please try again shortly."
            )
        if resp.status_code >= 400:
            raise UpstreamError(
                f"The Parks Canada booking system returned an error "
                f"(HTTP {resp.status_code}) for {path}."
            )
        try:
            return resp.json()
        except ValueError as exc:
            raise UpstreamError(
                f"The Parks Canada booking system returned an unexpected "
                f"response for {path}."
            ) from exc

    def fetch_image(self, url: str) -> Optional[tuple[bytes, str]]:
        """Fetch a photo by absolute URL, returning (bytes, format) or None.

        Used to deliver site photos as viewable image content. Best-effort: a
        photo that does not load must never fail the surrounding tool call. Only
        absolute https URLs on this platform's own image host are fetched, so the
        tool can never be turned into a general-purpose URL fetcher (SSRF guard).
        """
        if not url.startswith("https://"):
            return None
        if not url.startswith(self._base + "/"):
            return None
        try:
            resp = self._client.get(url)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None
        content_type = resp.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            return None
        fmt = content_type.split("/", 1)[1].split(";")[0].strip() or "jpeg"
        return resp.content, fmt

    # -- endpoints ----------------------------------------------------------

    def list_campgrounds(self) -> list[dict[str, Any]]:
        """Return reservable campgrounds: id, name, and root map id."""
        data = self._get("/api/resourceLocation")
        campgrounds = []
        for facility in data or []:
            categories = facility.get("resourceCategoryIds") or []
            if not CAMPSITE_CATEGORIES.intersection(categories):
                continue
            campgrounds.append(
                {
                    "resource_location_id": facility.get("resourceLocationId"),
                    "name": localized(facility.get("localizedValues"), "fullName"),
                    "root_map_id": facility.get("rootMapId"),
                }
            )
        return campgrounds

    def list_equipment_types(self) -> list[dict[str, Any]]:
        """Return equipment types: per-area subEquipmentCategoryId + name."""
        data = self._get("/api/equipment")
        types: list[dict[str, Any]] = []
        for category in data or []:
            for sub in category.get("subEquipmentCategories") or []:
                types.append(
                    {
                        "equipment_id": sub.get("subEquipmentCategoryId"),
                        "name": localized(sub.get("localizedValues"), "name"),
                    }
                )
        return types

    def get_resources(self, resource_location_id: int | str) -> dict[str, dict[str, Any]]:
        """Return the resource collection for a campground, keyed by resourceId.

        Each resource carries its name, capacity, accessibility attribute
        (-32756) and service type. This is how we obtain per-site name and
        accessibility (the old per-site details endpoint was removed upstream).
        """
        data = self._get(
            "/api/resourcelocation/resources",
            params={"resourceLocationId": resource_location_id},
        )
        # The API returns a dict keyed by resourceId.
        if isinstance(data, dict):
            return {str(k): v for k, v in data.items()}
        # Be tolerant if a future version returns a list.
        return {str(r.get("resourceId")): r for r in (data or [])}

    def attribute_definitions(self) -> dict[str, Any]:
        """Return the filterable attribute dictionary, keyed by attribute id (str).

        Each definition has a localized display name and enum value labels, used
        to describe sites (service type, amenities, accessibility) in plain
        language (Constitution Art. 3).
        """
        data = self._get("/api/attribute/filterable")
        return data if isinstance(data, dict) else {}

    def daily_availability(
        self,
        *,
        root_map_id: int | str,
        resource_location_id: int | str,
        start_date: _dt.date,
        end_date: _dt.date,
        equipment_id: Optional[int] = None,
    ) -> dict[str, list[Optional[int]]]:
        """Return per-day availability for each site over the stay window.

        Walks the campground's map tree (root map links to child maps that hold
        the actual sites) and returns, per ``resourceId``, the list of per-day
        availability codes the platform reports (0 = open that day). One request
        per map - the same upstream cost as a single-window check - so
        nights/weekends filtering is computed locally, not by hammering the
        API with many windowed queries (Constitution Art. 7.3). Read-only;
        never holds or books a site.
        """
        result: dict[str, list[Optional[int]]] = {}
        visited: set[str] = set()
        to_visit: list[str] = [str(root_map_id)]
        requests_made = 0

        while to_visit:
            map_id = to_visit.pop()
            if map_id in visited:
                continue
            visited.add(map_id)
            requests_made += 1
            if requests_made > _MAX_MAP_REQUESTS:
                break

            data = self._get(
                "/api/availability/map",
                params=self._availability_params(
                    map_id, resource_location_id, start_date, end_date, equipment_id
                ),
            )
            for resource_id, slots in (data.get("resourceAvailabilities") or {}).items():
                result[str(resource_id)] = [
                    slot.get("availability") for slot in (slots or [])
                ]
            for child_map_id in (data.get("mapLinkAvailabilities") or {}):
                if str(child_map_id) not in visited:
                    to_visit.append(str(child_map_id))

        return result

    @staticmethod
    def _availability_params(
        map_id: int | str,
        resource_location_id: int | str,
        start_date: _dt.date,
        end_date: _dt.date,
        equipment_id: Optional[int],
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "mapId": map_id,
            "resourceLocationId": resource_location_id,
            "bookingCategoryId": 0,
            "equipmentCategoryId": NON_GROUP_EQUIPMENT,
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "getDailyAvailability": "true",
            "isReserving": "true",
            "filterData": "[]",
            "numEquipment": 1,
        }
        if equipment_id is not None:
            params["subEquipmentCategoryId"] = equipment_id
        return params

    def build_booking_url(
        self,
        *,
        map_id: int | str,
        resource_location_id: int | str,
        start_date: _dt.date,
        end_date: _dt.date,
        party_size: int,
        equipment_id: Optional[int] = None,
    ) -> str:
        """Build the campground-level deep link the citizen opens to book.

        Prefills the campground, dates, party size and equipment. The citizen
        chooses the exact site and confirms in their own session; this never
        books (Constitution Art. 2).
        """
        sub_equipment = "" if equipment_id is None else equipment_id
        return (
            f"{self._base}/create-booking/results"
            f"?mapId={map_id}"
            "&bookingCategoryId=0"
            f"&startDate={start_date.isoformat()}"
            f"&endDate={end_date.isoformat()}"
            "&isReserving=true"
            f"&equipmentId={NON_GROUP_EQUIPMENT}"
            f"&subEquipmentId={sub_equipment}"
            f"&partySize={party_size}"
            f"&resourceLocationId={resource_location_id}"
        )

    def close(self) -> None:
        self._client.close()


def resource_is_accessible(resource: dict[str, Any]) -> bool:
    """Return True if a resource record is marked accessible.

    Reads the "Accessible" attribute (-32756, value 0 = Yes), verified against
    the live data and cross-checked with the Service Type attribute. This is the
    first-class accessibility signal (Constitution Art. 3).
    """
    for attribute in resource.get("definedAttributes") or []:
        if attribute.get("attributeDefinitionId") == ACCESSIBLE_ATTR:
            values = attribute.get("values")
            if values is None and attribute.get("value") is not None:
                values = [attribute["value"]]
            return 0 in (values or [])
    return False


def _attr_values(resource: dict[str, Any], attribute_id: int) -> Iterable[int]:
    for attribute in resource.get("definedAttributes") or []:
        if attribute.get("attributeDefinitionId") == attribute_id:
            values = attribute.get("values")
            if values is None and attribute.get("value") is not None:
                values = [attribute["value"]]
            return values or []
    return []
