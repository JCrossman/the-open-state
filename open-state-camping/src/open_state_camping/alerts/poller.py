"""Background poller that watches alerts for openings (M1).

Checks each active alert on an interval, never faster than the 5-minute floor and
with jitter, so we are a polite guest on the reservation system (Constitution
Art. 7.3; docs/01-architecture.md "Upstream politeness"). When a watched search
finds a site, it retires the alert and sends a plain-language message to the
citizen's own notification link, if they gave one.

It only *notifies*; the citizen still books in their own session. Automation
never completes a booking or competes for a contested site (Art. 2).
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Awaitable, Callable, Optional

import httpx

from open_state_camping.alerts.store import Alert, AlertStore
from open_state_camping.config import Config
from open_state_camping.providers.base import CampingProvider
from open_state_camping.tls import verify_setting

logger = logging.getLogger(__name__)

# Fraction of the interval added as random jitter, so polls do not align.
_JITTER_FRACTION = 0.15

ProviderResolver = Callable[[str], CampingProvider]
Notifier = Callable[[str, str], Awaitable[bool]]


class AlertPoller:
    """Periodically checks active alerts and notifies on a hit."""

    def __init__(
        self,
        store: AlertStore,
        provider_resolver: ProviderResolver,
        config: Config,
        notifier: Optional[Notifier] = None,
    ) -> None:
        self._store = store
        self._resolve = provider_resolver
        self._config = config
        self._notify = notifier or _http_notify
        self._stop = asyncio.Event()

    async def run(self) -> None:
        """Loop until stopped: check all alerts, then sleep (with jitter)."""
        logger.info(
            "Alert poller started; interval %d minutes (floored at the 5-minute "
            "minimum).",
            self._config.poll_interval_minutes,
        )
        while not self._stop.is_set():
            await self.check_once()
            await self._sleep_with_jitter()

    def stop(self) -> None:
        self._stop.set()

    async def check_once(self) -> None:
        """Check every active alert exactly once."""
        for alert in self._store.list_active():
            try:
                await self._check_alert(alert)
            except Exception as exc:  # noqa: BLE001 - one bad alert must not stop others
                logger.warning("Alert %s check failed: %s", alert.id, exc)
                self._store.mark_checked(alert.id, f"check failed: {exc}")

    async def _check_alert(self, alert: Alert) -> None:
        provider = self._resolve(alert.provider)
        # Provider calls are blocking network I/O; keep them off the event loop.
        sites = await asyncio.to_thread(
            provider.search_sites,
            recreation_area_id=alert.recreation_area_id,
            campground_id=alert.campground_id,
            start_date=alert.start_date,
            end_date=alert.end_date,
            party_size=alert.party_size,
            equipment_type=alert.equipment_type,
            accessible_only=alert.accessible_only,
            nights=alert.nights,
            weekends_only=alert.weekends_only,
        )
        if not sites:
            self._store.mark_checked(alert.id, "no matching sites yet")
            return

        accessible = sum(1 for s in sites if s.accessible)
        summary = f"{len(sites)} site(s) open ({accessible} accessible)"
        self._store.mark_fired(alert.id, summary)
        if alert.notify_target:
            message = _hit_message(alert, sites)
            try:
                await self._notify(alert.notify_target, message)
            except Exception as exc:  # noqa: BLE001 - notification is best-effort
                logger.warning("Notify for alert %s failed: %s", alert.id, exc)

    async def _sleep_with_jitter(self) -> None:
        base = self._config.poll_interval_minutes * 60
        delay = base + random.uniform(0, base * _JITTER_FRACTION)
        try:
            # Wake immediately if asked to stop.
            await asyncio.wait_for(self._stop.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass


def _hit_message(alert: Alert, sites) -> str:
    accessible = sum(1 for s in sites if s.accessible)
    stay = f"{alert.start_date.isoformat()} to {alert.end_date.isoformat()}"
    lines = [
        f"Good news - {len(sites)} campsite(s) just opened for your watch "
        f"({stay}, party of {alert.party_size}). {accessible} are marked accessible.",
        "Open your prepared booking link, sign in to your own Parks Canada "
        "account, and confirm the site yourself:",
        sites[0].booking_url,
        "Sent by The Open State, an independent tool not operated by Parks Canada.",
    ]
    return "\n".join(lines)


async def _http_notify(target: str, message: str) -> bool:
    """POST a plain-text message to the citizen's own notification link.

    The target is a URL the citizen controls (e.g. an ntfy.sh topic). We store no
    account or credential - only the link they gave us (Constitution Art. 1).
    """
    async with httpx.AsyncClient(timeout=15.0, verify=verify_setting()) as client:
        resp = await client.post(target, content=message.encode("utf-8"))
        return resp.is_success
