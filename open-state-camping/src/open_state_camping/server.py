"""MCP server for The Open State: Camping (M1, Parks Canada, local stdio).

Exposes a small set of plain-language tools a citizen can reach through their own
AI assistant: find a campground, see equipment types, search for open sites
(filtering for accessibility), get a site's details, and prepare a booking link
they confirm themselves.

Design rules this file follows (from CONSTITUTION.md):
- Tools are read-only and never book, pay, or store credentials (Art. 1, 2).
  `prepare_booking_url` only builds a deep link; the citizen confirms in their own
  Parks Canada session.
- Output is plain language and reads cleanly aloud for screen readers - no tables
  or emoji - and accessibility is stated first-class (Art. 3).
- Failures are reported plainly rather than guessed (Art. 7.2).
- The tool is independent of, and not endorsed by, Parks Canada (Art. 6.3); this
  is disclosed to the citizen.

Alert tools (create_alert / list_alerts / delete_alert) are added in the next
milestone step alongside the alert store and poller.
"""

from __future__ import annotations

import datetime as _dt
from typing import Optional

from fastmcp import FastMCP
from mcp.types import ToolAnnotations

from open_state_camping.config import Config
from open_state_camping.providers.going_to_camp.client import QueueItError, UpstreamError
from open_state_camping.providers.parks_canada import (
    PARKS_CANADA_REC_AREA_ID,
    ParksCanadaProvider,
)

mcp = FastMCP("Open State: Camping")

_INDEPENDENCE_NOTE = (
    "The Open State is an independent public-interest tool. It is not operated by "
    "or endorsed by Parks Canada."
)

_provider: Optional[ParksCanadaProvider] = None


def get_provider() -> ParksCanadaProvider:
    """Build the Parks Canada provider on first use (avoids network at import)."""
    global _provider
    if _provider is None:
        _provider = ParksCanadaProvider(config=Config.from_env())
    return _provider


def _readonly(title: str) -> ToolAnnotations:
    # Read-only tools that reach an external service (the live booking platform).
    return ToolAnnotations(title=title, readOnlyHint=True, openWorldHint=True)


def _problem(exc: Exception) -> str:
    """Turn an error into a plain-language message for the citizen (Art. 7.2)."""
    if isinstance(exc, (QueueItError, UpstreamError)):
        return str(exc)
    return (
        "Sorry, something went wrong while reaching the Parks Canada booking "
        "system. Please try again in a moment."
    )


@mcp.tool(
    annotations=_readonly("Find a Parks Canada campground"),
)
def search_parks(query: str, country: str = "CA") -> str:
    """Find Parks Canada campgrounds by a plain-language place name.

    Use this first when a citizen names a park or place (for example "Banff" or
    "Jasper"). It returns matching campgrounds and their ids, which the other
    tools need. Only Canadian national parks are covered.
    """
    try:
        areas = get_provider().search_parks(query, country)
    except Exception as exc:  # noqa: BLE001 - surface a friendly message
        return _problem(exc)

    if not areas or not areas[0].campgrounds:
        return (
            f'I could not find a Parks Canada campground matching "{query}". '
            "Try a national park name such as Banff, Jasper, or Pacific Rim."
        )
    area = areas[0]
    campgrounds = area.campgrounds
    lines = [
        f'Found {len(campgrounds)} Parks Canada campground(s) matching "{query}". '
        + _INDEPENDENCE_NOTE,
        "",
        "Campgrounds:",
    ]
    for campground in campgrounds[:50]:
        lines.append(f"- {campground.name} (campground id: {campground.campground_id})")
    if len(campgrounds) > 50:
        lines.append(f"- ... and {len(campgrounds) - 50} more.")
    lines += [
        "",
        f"Next, search for open sites using recreation area id "
        f"{area.recreation_area_id} and one of the campground ids above, along "
        "with your dates and party size.",
    ]
    return "\n".join(lines)


@mcp.tool(
    annotations=_readonly("List equipment types"),
)
def list_equipment_types(recreation_area_id: str = PARKS_CANADA_REC_AREA_ID) -> str:
    """List the equipment types you can filter sites by (tent, RV, and so on).

    Use this when a citizen wants to search for a specific kind of site. Pass the
    returned equipment id as `equipment_type` to `search_sites`.
    """
    try:
        types = get_provider().list_equipment_types(recreation_area_id)
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)

    if not types:
        return "No equipment types were returned for that recreation area."
    lines = ["Equipment types you can filter sites by:"]
    for equipment in types:
        lines.append(f"- {equipment.name} (equipment id: {equipment.equipment_id})")
    lines += [
        "",
        "Pass one of these equipment ids as equipment_type when you search for sites.",
    ]
    return "\n".join(lines)


@mcp.tool(
    annotations=_readonly("Search for open campsites"),
)
def search_sites(
    campground_id: str,
    start_date: _dt.date,
    end_date: _dt.date,
    party_size: int,
    recreation_area_id: str = PARKS_CANADA_REC_AREA_ID,
    equipment_type: Optional[str] = None,
    accessible_only: bool = False,
    nights: Optional[int] = None,
    weekends_only: bool = False,
) -> str:
    """Find open campsites in a campground for a stay, with accessibility first.

    Use this after `search_parks` gives you a campground id. `start_date` and
    `end_date` are the arrival and departure dates (the nights are the days in
    between). Set `accessible_only` to true to return only sites Parks Canada
    marks as accessible. `nights` finds sites open for that many consecutive
    nights within the window; `weekends_only` looks at Friday and Saturday nights.

    The result includes a booking link the citizen opens to choose their exact
    site and confirm in their own Parks Canada session. This tool never books.
    """
    try:
        sites = get_provider().search_sites(
            recreation_area_id=recreation_area_id,
            campground_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            party_size=party_size,
            equipment_type=equipment_type,
            accessible_only=accessible_only,
            nights=nights,
            weekends_only=weekends_only,
        )
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)

    stay = f"{start_date.isoformat()} to {end_date.isoformat()}"
    if not sites:
        message = (
            f"No open sites were found in that campground for {stay}, party of "
            f"{party_size}"
        )
        message += " (accessible sites only)." if accessible_only else "."
        message += (
            " Sites in popular parks fill quickly. You can ask me to watch this "
            "search and alert you if one opens up."
        )
        return message

    accessible_count = sum(1 for s in sites if s.accessible)
    if accessible_only:
        header = (
            f"Found {len(sites)} accessible open site(s) for {stay}, party of "
            f"{party_size}."
        )
    else:
        header = (
            f"Found {len(sites)} open site(s) for {stay}, party of {party_size}. "
            f"{accessible_count} of them are marked accessible."
        )
    lines = [header, ""]
    for site in sites[:25]:
        parts = [f"Site {site.site_name}"]
        parts.append("accessible" if site.accessible else "not marked accessible")
        if site.site_type:
            parts.append(site.site_type)
        if site.max_occupancy:
            parts.append(f"sleeps up to {site.max_occupancy}")
        lines.append("- " + "; ".join(parts) + f" (campsite id: {site.campsite_id})")
    if len(sites) > 25:
        lines.append(f"- ... and {len(sites) - 25} more open site(s).")
    lines += [
        "",
        "To book, open this link in your browser, sign in to your own Parks "
        "Canada account, choose your exact site, and confirm:",
        sites[0].booking_url,
        "",
        "This tool prepares the booking only. You complete and pay for it "
        "yourself in your Parks Canada session; it never books or pays for you.",
    ]
    return "\n".join(lines)


@mcp.tool(
    annotations=_readonly("Get campsite details"),
)
def get_site_details(
    campground_id: str,
    campsite_id: str,
    recreation_area_id: str = PARKS_CANADA_REC_AREA_ID,
) -> str:
    """Get plain-language detail about one campsite, including accessibility.

    Use this when a citizen wants more about a specific site from a search
    result. Pass the campground id and the campsite id from `search_sites`.
    """
    try:
        details = get_provider().site_details(
            recreation_area_id=recreation_area_id,
            campground_id=campground_id,
            campsite_id=campsite_id,
        )
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)

    lines = [f"Site {details.site_name} (Parks Canada):"]
    lines.append(
        "This site is marked accessible by Parks Canada."
        if details.accessible
        else "This site is not marked as accessible."
    )
    if details.max_occupancy:
        lines.append(f"It sleeps up to {details.max_occupancy} people.")
    if details.site_type:
        lines.append(f"Service type: {details.site_type}.")
    if details.amenities:
        lines.append("Site details:")
        lines.extend(f"- {amenity}" for amenity in details.amenities)
    if details.photos:
        lines.append(
            f"There are {len(details.photos)} photo(s) of this site: "
            + ", ".join(details.photos[:5])
        )
    return "\n".join(lines)


@mcp.tool(
    annotations=_readonly("Prepare a booking link"),
)
def prepare_booking_url(
    campground_id: str,
    campsite_id: str,
    start_date: _dt.date,
    end_date: _dt.date,
    party_size: int,
    recreation_area_id: str = PARKS_CANADA_REC_AREA_ID,
    equipment_type: Optional[str] = None,
) -> str:
    """Prepare a Parks Canada booking link the citizen opens and confirms.

    Use this when a citizen has chosen where and when they want to camp. It
    returns a link that opens the Parks Canada site with the campground, dates,
    party size, and equipment filled in. The citizen signs in, picks their exact
    site, and confirms and pays themselves. This tool never books or pays.
    """
    try:
        url = get_provider().booking_url(
            recreation_area_id=recreation_area_id,
            campground_id=campground_id,
            campsite_id=campsite_id,
            start_date=start_date,
            end_date=end_date,
            party_size=party_size,
            equipment_type=equipment_type,
        )
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)

    return (
        "Here is your prepared Parks Canada booking link. Open it in your "
        "browser, sign in to your own account, choose your exact site, and "
        "confirm and pay yourself. This tool never books or pays on your "
        "behalf.\n\n" + url
    )


def main() -> None:
    """Run the MCP server. Defaults to stdio (M1); HTTP is selected via env (M2+)."""
    config = Config.from_env()
    if config.transport == "http":
        mcp.run(transport="http")
    else:
        mcp.run()


if __name__ == "__main__":
    main()
