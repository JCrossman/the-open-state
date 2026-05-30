"""SQLite store for cancellation-watch alerts (M1).

Stores no citizen identity. Each alert is keyed by an opaque generated id, not a
person (docs/01-architecture.md "Statelessness"; Constitution Art. 5). The only
contact detail kept is an optional ``notify_target`` - a notification link the
citizen controls (e.g. an ntfy.sh topic). No account, password, or government
credential is ever stored (Art. 1).

For M1 this lives in a local SQLite file on the citizen's own machine; encryption
at rest becomes a requirement for the hosted store in M2+/M3.
"""

from __future__ import annotations

import datetime as _dt
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,
    recreation_area_id TEXT NOT NULL,
    campground_id   TEXT NOT NULL,
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    party_size      INTEGER NOT NULL,
    equipment_type  TEXT,
    accessible_only INTEGER NOT NULL DEFAULT 0,
    nights          INTEGER,
    weekends_only   INTEGER NOT NULL DEFAULT 0,
    notify_target   TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TEXT NOT NULL,
    last_checked    TEXT,
    last_result     TEXT
);
"""


@dataclass(frozen=True)
class Alert:
    """A persisted cancellation watch. No citizen identity is stored."""

    id: str
    provider: str
    recreation_area_id: str
    campground_id: str
    start_date: _dt.date
    end_date: _dt.date
    party_size: int
    equipment_type: Optional[str]
    accessible_only: bool
    nights: Optional[int]
    weekends_only: bool
    notify_target: Optional[str]
    status: str
    created_at: str
    last_checked: Optional[str]
    last_result: Optional[str]


def _row_to_alert(row: sqlite3.Row) -> Alert:
    return Alert(
        id=row["id"],
        provider=row["provider"],
        recreation_area_id=row["recreation_area_id"],
        campground_id=row["campground_id"],
        start_date=_dt.date.fromisoformat(row["start_date"]),
        end_date=_dt.date.fromisoformat(row["end_date"]),
        party_size=row["party_size"],
        equipment_type=row["equipment_type"],
        accessible_only=bool(row["accessible_only"]),
        nights=row["nights"],
        weekends_only=bool(row["weekends_only"]),
        notify_target=row["notify_target"],
        status=row["status"],
        created_at=row["created_at"],
        last_checked=row["last_checked"],
        last_result=row["last_result"],
    )


class AlertStore:
    """A small SQLite-backed store. Opens a connection per operation so it is
    safe to use from the server's event loop and the poller's worker thread."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def add(
        self,
        *,
        provider: str,
        recreation_area_id: str,
        campground_id: str,
        start_date: _dt.date,
        end_date: _dt.date,
        party_size: int,
        equipment_type: Optional[str] = None,
        accessible_only: bool = False,
        nights: Optional[int] = None,
        weekends_only: bool = False,
        notify_target: Optional[str] = None,
    ) -> Alert:
        """Persist a new watch and return it with its opaque id."""
        alert_id = uuid.uuid4().hex[:12]
        created_at = _now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO alerts (id, provider, recreation_area_id, campground_id,
                    start_date, end_date, party_size, equipment_type, accessible_only,
                    nights, weekends_only, notify_target, status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?)
                """,
                (
                    alert_id, provider, str(recreation_area_id), str(campground_id),
                    start_date.isoformat(), end_date.isoformat(), party_size,
                    equipment_type, int(accessible_only), nights, int(weekends_only),
                    notify_target, created_at,
                ),
            )
        got = self.get(alert_id)
        assert got is not None
        return got

    def get(self, alert_id: str) -> Optional[Alert]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM alerts WHERE id = ?", (alert_id,)
            ).fetchone()
        return _row_to_alert(row) if row else None

    def list_all(self) -> list[Alert]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM alerts ORDER BY created_at"
            ).fetchall()
        return [_row_to_alert(r) for r in rows]

    def list_active(self) -> list[Alert]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM alerts WHERE status = 'active' ORDER BY created_at"
            ).fetchall()
        return [_row_to_alert(r) for r in rows]

    def delete(self, alert_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
            return cur.rowcount > 0

    def mark_checked(self, alert_id: str, result: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE alerts SET last_checked = ?, last_result = ? WHERE id = ?",
                (_now(), result, alert_id),
            )

    def mark_fired(self, alert_id: str, result: str) -> None:
        """Record a hit and retire the watch so it does not re-notify."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE alerts SET status = 'fired', last_checked = ?, "
                "last_result = ? WHERE id = ?",
                (_now(), result, alert_id),
            )


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
