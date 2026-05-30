"""Runtime configuration for The Open State: Camping.

All settings come from environment variables with safe local defaults so M1
runs with no setup. Nothing here stores or reads citizen credentials
(Constitution Art. 1).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Camply/GoingToCamp politeness floor: never poll faster than this
# (docs/01-architecture.md "Upstream politeness").
POLLING_INTERVAL_MINIMUM_MINUTES = 5
POLLING_INTERVAL_DEFAULT_MINUTES = 10

# Honest identification (Constitution Art. 7.3). NOTE: Parks Canada currently
# returns HTTP 403 to non-browser User-Agents, so a browser-like UA is required
# for the tool to function today. This tension (honest identification vs. being
# blocked) is documented in docs/parks-canada-api-findings.md and is a candidate
# for resolution via an official Parks Canada relationship (the Track-2 goal).
# The UA is configurable so an operator can set whatever an agreement allows.
_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class Config:
    """Process configuration, read once from the environment."""

    # "stdio" for local (M1) or "http" for remote (M2+). Tool definitions are
    # identical in both; only the transport switch changes.
    transport: str = "stdio"
    # SQLite path for the alert store (M1). Keyed by opaque id, no identity.
    alert_db_path: str = "open_state_camping_alerts.db"
    # Minutes between alert poll checks; floored at the minimum above.
    poll_interval_minutes: int = POLLING_INTERVAL_DEFAULT_MINUTES
    # HTTP client settings for upstream booking platforms.
    user_agent: str = _DEFAULT_USER_AGENT
    http_timeout_seconds: float = 30.0
    # Base URL for auto-provisioned notification channels. ntfy.sh needs no
    # sign-up; an operator can point this at a self-hosted ntfy for privacy.
    ntfy_base: str = "https://ntfy.sh"

    @classmethod
    def from_env(cls) -> "Config":
        """Build configuration from environment variables."""
        raw_interval = os.getenv("OPEN_STATE_POLL_INTERVAL_MINUTES")
        interval = int(raw_interval) if raw_interval else POLLING_INTERVAL_DEFAULT_MINUTES
        return cls(
            transport=os.getenv("OPEN_STATE_TRANSPORT", "stdio"),
            alert_db_path=os.getenv(
                "OPEN_STATE_ALERT_DB", "open_state_camping_alerts.db"
            ),
            poll_interval_minutes=enforce_polling_floor(interval),
            user_agent=os.getenv("OPEN_STATE_USER_AGENT", _DEFAULT_USER_AGENT),
            http_timeout_seconds=float(os.getenv("OPEN_STATE_HTTP_TIMEOUT", "30")),
            ntfy_base=os.getenv("OPEN_STATE_NTFY_BASE", "https://ntfy.sh"),
        )


def enforce_polling_floor(minutes: int) -> int:
    """Never allow a poll interval below the upstream-politeness minimum.

    Rejecting shorter intervals protects the reservation systems from abuse
    (Constitution Art. 7.3) and matches camply's own floor.
    """
    if minutes < POLLING_INTERVAL_MINIMUM_MINUTES:
        return POLLING_INTERVAL_MINIMUM_MINUTES
    return minutes
