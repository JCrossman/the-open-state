"""Tests for the alert store, poller, and alert tools (offline).

Verify that alerts persist with no identity, that the poller fires and notifies
on a hit (and only marks-checked when nothing is open), and that the tools behave.
"""

from __future__ import annotations

import asyncio
import datetime as dt

import pytest

from open_state_camping import server
from open_state_camping.alerts import AlertStore
from open_state_camping.alerts.poller import AlertPoller
from open_state_camping.config import Config, enforce_polling_floor
from open_state_camping.providers.base import AvailableSite

CAMPGROUND_ID = "-2147483644"
START = dt.date(2026, 7, 17)
END = dt.date(2026, 7, 19)


def _make_site(accessible: bool) -> AvailableSite:
    return AvailableSite(
        provider="parks_canada",
        recreation_area="Parks Canada",
        recreation_area_id="14",
        campground="Banff - Tunnel Mountain Trailer Court",
        campground_id=CAMPGROUND_ID,
        campsite_id="-2147475789",
        site_name="104",
        accessible=accessible,
        available_dates=(START,),
        booking_url="https://reservation.pc.gc.ca/create-booking/results?x=1",
    )


class _StubProvider:
    name = "parks_canada"

    def __init__(self, sites):
        self._sites = sites
        self.calls = 0

    def search_sites(self, **kwargs):
        self.calls += 1
        return list(self._sites)


class _FakeNotifier:
    def __init__(self):
        self.calls = []

    async def __call__(self, target, message):
        self.calls.append((target, message))
        return True


@pytest.fixture
def store(tmp_path) -> AlertStore:
    return AlertStore(str(tmp_path / "alerts.db"))


# -- store ------------------------------------------------------------------


def test_store_add_keeps_no_identity_and_lists(store: AlertStore):
    alert = store.add(
        provider="parks_canada",
        recreation_area_id="14",
        campground_id=CAMPGROUND_ID,
        start_date=START,
        end_date=END,
        party_size=2,
        accessible_only=True,
    )
    assert alert.id and len(alert.id) <= 12
    assert alert.status == "active"
    # No identity column exists on the record.
    assert not hasattr(alert, "user") and not hasattr(alert, "email")
    assert [a.id for a in store.list_active()] == [alert.id]


def test_store_mark_fired_retires_alert(store: AlertStore):
    alert = store.add(
        provider="parks_canada", recreation_area_id="14", campground_id=CAMPGROUND_ID,
        start_date=START, end_date=END, party_size=2,
    )
    store.mark_fired(alert.id, "1 site open")
    assert store.get(alert.id).status == "fired"
    assert store.list_active() == []  # no longer polled


def test_store_delete(store: AlertStore):
    alert = store.add(
        provider="parks_canada", recreation_area_id="14", campground_id=CAMPGROUND_ID,
        start_date=START, end_date=END, party_size=2,
    )
    assert store.delete(alert.id) is True
    assert store.get(alert.id) is None
    assert store.delete("nope") is False


# -- poller -----------------------------------------------------------------


def test_poller_fires_and_notifies_on_hit(store: AlertStore):
    alert = store.add(
        provider="parks_canada", recreation_area_id="14", campground_id=CAMPGROUND_ID,
        start_date=START, end_date=END, party_size=2,
        notify_target="https://ntfy.sh/citizen-topic",
    )
    stub = _StubProvider([_make_site(accessible=True), _make_site(accessible=False)])
    notifier = _FakeNotifier()
    poller = AlertPoller(store, lambda name: stub, Config(), notifier=notifier)

    asyncio.run(poller.check_once())

    assert store.get(alert.id).status == "fired"
    assert len(notifier.calls) == 1
    target, message = notifier.calls[0]
    assert target == "https://ntfy.sh/citizen-topic"
    assert "create-booking/results" in message
    assert "Parks Canada" in message


def test_poller_marks_checked_when_nothing_open(store: AlertStore):
    alert = store.add(
        provider="parks_canada", recreation_area_id="14", campground_id=CAMPGROUND_ID,
        start_date=START, end_date=END, party_size=2,
    )
    stub = _StubProvider([])
    notifier = _FakeNotifier()
    poller = AlertPoller(store, lambda name: stub, Config(), notifier=notifier)

    asyncio.run(poller.check_once())

    assert store.get(alert.id).status == "active"  # still watching
    assert store.get(alert.id).last_result == "no matching sites yet"
    assert notifier.calls == []


def test_poller_does_not_notify_without_target(store: AlertStore):
    store.add(
        provider="parks_canada", recreation_area_id="14", campground_id=CAMPGROUND_ID,
        start_date=START, end_date=END, party_size=2,  # no notify_target
    )
    notifier = _FakeNotifier()
    poller = AlertPoller(
        store, lambda name: _StubProvider([_make_site(True)]), Config(), notifier=notifier
    )
    asyncio.run(poller.check_once())
    assert notifier.calls == []  # fired, but nowhere to send


def test_polling_floor_enforced():
    assert enforce_polling_floor(1) == 5
    assert enforce_polling_floor(10) == 10


# -- tools ------------------------------------------------------------------


@pytest.fixture
def tools(provider, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "_provider", provider)
    monkeypatch.setattr(server, "_store", AlertStore(str(tmp_path / "alerts.db")))
    return server


def test_create_list_delete_alert_tools(tools):
    out = tools.create_alert.fn(
        campground_id=CAMPGROUND_ID, start_date=START, end_date=END, party_size=2
    )
    assert "watch id is" in out
    alert_id = out.split("watch id is")[1].split(".")[0].strip()

    listed = tools.list_alerts.fn()
    assert alert_id in listed and "watching" in listed

    deleted = tools.delete_alert.fn(alert_id)
    assert "Deleted" in deleted
    assert "no saved alerts" in tools.list_alerts.fn().lower()


def test_create_alert_rejects_bad_notify_target(tools):
    out = tools.create_alert.fn(
        campground_id=CAMPGROUND_ID, start_date=START, end_date=END, party_size=2,
        notify_target="not-a-url",
    )
    assert "must be a web address" in out
