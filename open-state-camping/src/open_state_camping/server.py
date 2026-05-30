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

import asyncio
import datetime as _dt
import logging
from contextlib import asynccontextmanager
from typing import Optional, Union

from fastmcp import FastMCP
from fastmcp.utilities.types import Image
from mcp.types import ToolAnnotations
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from open_state_camping.alerts import AlertPoller, AlertStore, build_store
from open_state_camping.config import Config
from open_state_camping.notify import generate_channel, send_message
from open_state_camping.providers.going_to_camp.client import QueueItError, UpstreamError
from open_state_camping.providers.parks_canada import (
    PARKS_CANADA_REC_AREA_ID,
    ParksCanadaProvider,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastMCP):
    """Run the alert poller in the background for the life of the server.

    Hosted (M2) this is the ASGI lifespan; local (stdio) the poller runs while the
    citizen's assistant session is open. In the read-only preview (alerts
    disabled) there are no watches, so the poller does not run at all.
    """
    if not Config.from_env().enable_alerts:
        yield
        return
    poller = AlertPoller(get_store(), _resolve_provider, Config.from_env())
    task = asyncio.create_task(poller.run())
    try:
        yield
    finally:
        poller.stop()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


# In the read-only preview, hide the alert tools by tag (they assume a single
# trusted user; they return scoped behind auth - docs/m2-validation-findings.md).
mcp = FastMCP(
    "Open State: Camping",
    lifespan=_lifespan,
    exclude_tags=None if Config.from_env().enable_alerts else {"alerts"},
)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Request) -> JSONResponse:
    """Liveness probe, separate from /mcp and unauthenticated (M2 hosting)."""
    return JSONResponse({"status": "ok", "service": "open-state-camping"})


@mcp.custom_route("/", methods=["GET"])
async def root(_request: Request) -> PlainTextResponse:
    """Friendly note for a human who opens the public URL in a browser."""
    return PlainTextResponse(
        "The Open State: Camping - an independent, public-interest tool for "
        "searching Parks Canada campsite availability through your own AI "
        "assistant. It is not operated by or endorsed by Parks Canada.\n\n"
        "This is a Model Context Protocol (MCP) server. Connect an MCP client to "
        "the /mcp endpoint. Health: /health\n"
    )

_INDEPENDENCE_NOTE = (
    "The Open State is an independent public-interest tool. It is not operated by "
    "or endorsed by Parks Canada."
)

_provider: Optional[ParksCanadaProvider] = None
_store: Optional[AlertStore] = None


def get_provider() -> ParksCanadaProvider:
    """Build the Parks Canada provider on first use (avoids network at import)."""
    global _provider
    if _provider is None:
        _provider = ParksCanadaProvider(config=Config.from_env())
    return _provider


def get_store() -> AlertStore:
    """Build the alert store on first use, selecting the configured backend."""
    global _store
    if _store is None:
        config = Config.from_env()
        _store = build_store(config.alert_backend, config.alert_db_path)
    return _store


def _resolve_provider(provider_name: str) -> ParksCanadaProvider:
    """Map a stored alert's provider name to a provider (M1: Parks Canada only)."""
    if provider_name == ParksCanadaProvider.name:
        return get_provider()
    raise UpstreamError(f"No provider is available for '{provider_name}'.")


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
    annotations=_readonly("Search a whole park for availability"),
)
def search_park_availability(
    query: str,
    start_date: _dt.date,
    end_date: _dt.date,
    party_size: int,
    equipment_type: Optional[str] = None,
    accessible_only: bool = False,
    nights: Optional[int] = None,
    weekends_only: bool = False,
) -> str:
    """Check every campground in a park at once and say which have openings.

    Use this when a citizen names a place rather than one campground - for
    example "anything open in Banff?" It searches all of that park's campgrounds
    for the dates and party size in a single step and returns one consolidated
    list, so nothing is missed. Then use `search_sites` on a campground that has
    openings to see the individual sites, and `prepare_booking_url` to book.

    `start_date` and `end_date` are arrival and departure. Set `accessible_only`
    for sites Parks Canada marks accessible; `nights` / `weekends_only` work as in
    `search_sites`. This tool never books.
    """
    try:
        results = get_provider().search_park_availability(
            query=query,
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

    if not results:
        return (
            f'I could not find a Parks Canada park matching "{query}". Try a '
            "national park name such as Banff, Jasper, or Pacific Rim."
        )

    stay = f"{start_date.isoformat()} to {end_date.isoformat()}"
    acc = " (accessible sites only)" if accessible_only else ""
    with_sites = [r for r in results if r.open_site_count > 0]
    lines = [
        f'Availability for "{query}", {stay}, party of {party_size}{acc}. '
        + _INDEPENDENCE_NOTE,
        "",
    ]
    if with_sites:
        lines.append("Campgrounds with openings:")
        for r in with_sites:
            note = (
                f", {r.accessible_count} marked accessible"
                if r.accessible_count
                else ""
            )
            lines.append(
                f"- {r.campground_name}: {r.open_site_count} open site(s){note} "
                f"(campground id: {r.campground_id})"
            )
        lines += [
            "",
            "Use search_sites with one of these campground ids to see the "
            "individual sites, then prepare_booking_url to book in your own "
            "Parks Canada session. This tool never books.",
        ]
    else:
        lines.append(
            "No campgrounds in that park have open sites for those dates. Sites "
            "in popular parks fill quickly; you can ask me to watch a specific "
            "campground and alert you if one opens up."
        )

    empty = [r for r in results if r.open_site_count == 0 and r.error is None]
    if empty and with_sites:
        lines.append("")
        lines.append(
            "No openings at: " + ", ".join(r.campground_name for r in empty) + "."
        )
    errored = [r for r in results if r.error is not None]
    if errored:
        lines.append("")
        lines.append(
            "I could not check: "
            + ", ".join(r.campground_name for r in errored)
            + ". You can try those individually with search_sites."
        )
    return "\n".join(lines)


# A photo is ~90 KB; cap how many we ever fetch so a tool call stays light.
_MAX_VIEWABLE_PHOTOS = 3


@mcp.tool(
    annotations=_readonly("Get campsite details"),
)
def get_site_details(
    campground_id: str,
    campsite_id: str,
    recreation_area_id: str = PARKS_CANADA_REC_AREA_ID,
    include_photos: bool = False,
) -> Union[str, list]:
    """Get plain-language detail about one campsite, including accessibility.

    Use this when a citizen wants more about a specific site from a search
    result. Pass the campground id and the campsite id from `search_sites`.

    Set `include_photos=True` when the citizen wants to *see* the site: the tool
    then returns the actual photos as viewable images (up to three) alongside the
    text, so they can be shown directly. Left off by default, the text still
    lists the photo links a person can open in a browser.
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

    images: list[Image] = []
    if details.photos and include_photos:
        provider = get_provider()
        for url in details.photos[:_MAX_VIEWABLE_PHOTOS]:
            fetched = provider.fetch_photo(url)
            if fetched is not None:
                data, fmt = fetched
                images.append(Image(data=data, format=fmt))
        shown = f"Showing {len(images)} photo(s) of this site." if images else (
            "I could not load the photos right now; you can open them in a browser:"
        )
        lines.append(shown)
        lines.append("Photo links: " + ", ".join(details.photos[:5]))
    elif details.photos:
        lines.append(
            f"There are {len(details.photos)} photo(s) of this site. Ask to see "
            "them, or open these links in a browser: "
            + ", ".join(details.photos[:5])
        )

    text = "\n".join(lines)
    if images:
        # Return text plus viewable image content blocks so the assistant can
        # actually look at the site, not just receive URLs. Convert each Image to
        # an MCP ImageContent block; a bare Image is not serializable in a list.
        from mcp.types import TextContent

        return [
            TextContent(type="text", text=text),
            *(img.to_image_content() for img in images),
        ]
    return text


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

    Use this when a citizen has chosen where and when they want to camp.
    `equipment_type` is **required** because Parks Canada's booking page will not
    proceed without it: ask the citizen what they are camping with (tent, RV,
    etc.) and pass the matching equipment id from `list_equipment_types`. The link
    opens the Parks Canada site with the campground, dates, party size, and
    equipment filled in; the citizen signs in, picks their exact site, and
    confirms and pays themselves. This tool never books or pays.
    """
    # Equipment is mandatory on the Parks Canada booking form, so a link without
    # it strands the citizen on a page they cannot submit. Guide them to pick one
    # rather than hand back a link that will not work.
    if equipment_type is None:
        return _equipment_prompt(recreation_area_id, reason="missing")
    try:
        valid = {e.equipment_id: e.name for e in
                 get_provider().list_equipment_types(recreation_area_id)}
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)
    if str(equipment_type) not in valid:
        return _equipment_prompt(recreation_area_id, reason="invalid")

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
        f"Here is your prepared Parks Canada booking link for a {valid[str(equipment_type)]}. "
        "Open it in your browser, sign in to your own account, choose your exact "
        "site, and confirm and pay yourself. This tool never books or pays on "
        "your behalf.\n\n" + url
    )


def _equipment_prompt(recreation_area_id: str, *, reason: str) -> str:
    """Ask the citizen to choose equipment, listing the valid options.

    Parks Canada requires equipment to book, so prepare_booking_url cannot make a
    working link without it. This returns a plain-language prompt plus the real
    options for the area, rather than a link that would fail on the page.
    """
    lead = (
        "Before I can prepare a booking link, I need to know what you are camping "
        "with - Parks Canada's booking page requires it."
        if reason == "missing"
        else "That equipment type is not one Parks Canada offers for this area. "
        "Please choose one of these:"
    )
    try:
        types = get_provider().list_equipment_types(recreation_area_id)
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)
    lines = [lead, ""]
    for t in types:
        lines.append(f"- {t.name} (equipment id: {t.equipment_id})")
    lines += [
        "",
        "Tell me which one fits, and I will prepare your booking link.",
    ]
    return "\n".join(lines)


@mcp.tool(
    tags={"alerts"},
    annotations=ToolAnnotations(
        title="Set a cancellation alert",
        readOnlyHint=False,
        destructiveHint=False,
        openWorldHint=True,
    ),
)
def create_alert(
    campground_id: str,
    start_date: _dt.date,
    end_date: _dt.date,
    party_size: int,
    recreation_area_id: str = PARKS_CANADA_REC_AREA_ID,
    equipment_type: Optional[str] = None,
    accessible_only: bool = False,
    nights: Optional[int] = None,
    weekends_only: bool = False,
    notify_target: Optional[str] = None,
) -> str:
    """Watch a campground for openings and tell the citizen when one appears.

    Use this when a search finds nothing but the citizen wants to be told if a
    cancellation frees a site. It saves the search and checks it on a polite
    schedule (never faster than every 5 minutes).

    For push notifications, set `notify_target="auto"` and I will create a
    private notification channel for the citizen - a random, unguessable ntfy.sh
    topic that needs no sign-up - and send a test message so they can confirm it
    works. Prefer this for a citizen who just wants to be pinged. Alternatively
    pass an http(s) link the citizen already controls (such as their own ntfy
    topic). Leave it empty to set a silent watch they check with list_alerts.

    No account, password, or personal information is stored - only the search and
    the notification link. This never books; the citizen confirms in their own
    session.
    """
    channel = None
    if notify_target == "auto":
        channel = generate_channel(Config.from_env().ntfy_base)
        notify_target = channel.subscribe_url
    elif notify_target and not notify_target.startswith(("http://", "https://")):
        return (
            "The notification link must be a web address starting with http:// "
            "or https:// that you control, such as an ntfy.sh topic link. You can "
            'also say "auto" and I will set up a private channel for you, or set '
            "an alert without one and check back with list_alerts."
        )
    try:
        alert = get_store().add(
            provider=ParksCanadaProvider.name,
            recreation_area_id=recreation_area_id,
            campground_id=campground_id,
            start_date=start_date,
            end_date=end_date,
            party_size=party_size,
            equipment_type=equipment_type,
            accessible_only=accessible_only,
            nights=nights,
            weekends_only=weekends_only,
            notify_target=notify_target,
        )
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)

    # For an auto channel, send a test ping so the citizen can confirm delivery
    # before relying on it. Best-effort: a failed ping never fails the watch.
    test_ok: Optional[bool] = None
    if channel is not None:
        try:
            test_ok = send_message(
                channel.subscribe_url,
                "This is a test from The Open State. Your campsite alerts will "
                "arrive here. You can mute or delete this topic at any time.",
                title="Open State alert channel ready",
            )
        except Exception:  # noqa: BLE001 - the test ping is best-effort
            test_ok = False

    interval = Config.from_env().poll_interval_minutes
    stay = f"{start_date.isoformat()} to {end_date.isoformat()}"
    lines = [
        f"Done. I am now watching that campground for {stay}, party of "
        f"{party_size}"
        + (" (accessible sites only)" if accessible_only else "")
        + f". Your watch id is {alert.id}.",
        f"I check about every {interval} minutes, never faster than every 5.",
    ]
    if channel is not None:
        lines.append(
            "I set up a private notification channel for you - no sign-up needed. "
            "Open this link to subscribe:\n  " + channel.subscribe_url
        )
        lines.append(
            "On a phone with the ntfy app installed, this opens it directly:\n  "
            + channel.app_url
        )
        if test_ok:
            lines.append(
                "I just sent a test message to it - check that it arrived so you "
                "know notifications are working."
            )
        elif test_ok is False:
            lines.append(
                "Note: my test message did not go through just now, but the "
                "channel is saved and I will try again when a site opens."
            )
        lines.append(
            "When a site opens, I will send a prepared booking link there that "
            "you confirm yourself."
        )
    elif notify_target:
        lines.append(
            "When a site opens, I will send a message to your notification link "
            "with a prepared booking link you confirm yourself."
        )
    else:
        lines.append(
            "Ask me to list your alerts to see whether anything has opened up."
        )
    return "\n".join(lines)


@mcp.tool(
    tags={"alerts"},
    annotations=ToolAnnotations(title="List your cancellation alerts", readOnlyHint=True),
)
def list_alerts() -> str:
    """List the cancellation watches that are currently saved and their status."""
    try:
        alerts = get_store().list_all()
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)

    if not alerts:
        return "You have no saved alerts."
    lines = [f"You have {len(alerts)} saved alert(s):", ""]
    for alert in alerts:
        stay = f"{alert.start_date.isoformat()} to {alert.end_date.isoformat()}"
        status = (
            "a site has opened - check your booking link"
            if alert.status == "fired"
            else "watching"
        )
        detail = f"- {alert.id}: campground {alert.campground_id}, {stay}, party of "
        detail += f"{alert.party_size}"
        if alert.accessible_only:
            detail += ", accessible only"
        detail += f" - {status}."
        if alert.last_result:
            detail += f" Last check: {alert.last_result}."
        lines.append(detail)
    return "\n".join(lines)


@mcp.tool(
    tags={"alerts"},
    annotations=ToolAnnotations(
        title="Delete a cancellation alert",
        readOnlyHint=False,
        destructiveHint=True,
        idempotentHint=True,
    ),
)
def delete_alert(alert_id: str) -> str:
    """Delete a saved cancellation watch by its id."""
    try:
        deleted = get_store().delete(alert_id)
    except Exception as exc:  # noqa: BLE001
        return _problem(exc)
    if deleted:
        return f"Deleted alert {alert_id}."
    return f"I could not find an alert with id {alert_id}."


def main() -> None:
    """Run the MCP server. Defaults to stdio (M1); HTTP is selected via env (M2+)."""
    config = Config.from_env()
    if config.transport == "http":
        # Global rate limit for upstream politeness (Art. 7.3). global_limit=True
        # is a single shared bucket - right here because all Claude traffic
        # arrives from one IP range, so per-client limiting would not bite.
        if config.rate_limit_rps > 0:
            from fastmcp.server.middleware.rate_limiting import RateLimitingMiddleware

            mcp.add_middleware(
                RateLimitingMiddleware(
                    max_requests_per_second=config.rate_limit_rps,
                    burst_capacity=config.rate_limit_burst,
                    global_limit=True,
                )
            )
        # Streamable HTTP at /mcp; /health and / are served alongside for probes.
        # stateless_http keeps multi-replica hosting (M2) from breaking sessions.
        mcp.run(
            transport="http",
            host=config.host,
            port=config.port,
            path=config.mcp_path,
            stateless_http=config.stateless_http,
        )
    else:
        mcp.run()


if __name__ == "__main__":
    main()
