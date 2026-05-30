"""Notification channels for cancellation alerts (M1).

A "channel" is just a web link the citizen controls. To spare the citizen the
chore of inventing an ntfy.sh topic and pasting it back, `generate_channel`
provisions a random, unguessable topic for them; they subscribe by opening the
link (ntfy needs no account). We store only the link, never an account,
password, or personal identifier (Constitution Art. 1, Art. 5).

Privacy note: an ntfy.sh topic is readable and writable by anyone who knows its
name, so the random suffix is the privacy boundary - it is the secret. An
operator who wants stronger guarantees can point OPEN_STATE_NTFY_BASE at a
self-hosted, access-controlled ntfy server.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

# A recognizable prefix plus a random suffix: the suffix keeps the full topic
# unguessable, which is what makes an open ntfy topic effectively private.
_TOPIC_PREFIX = "openstate-"
_TOKEN_BYTES = 12


@dataclass(frozen=True)
class NotificationChannel:
    """A freshly provisioned, citizen-controlled notification target."""

    topic: str
    # Open in a browser or the ntfy app to subscribe (no sign-up needed).
    subscribe_url: str
    # Deep link that opens the ntfy mobile app straight to the topic.
    app_url: str


def generate_channel(base: str) -> NotificationChannel:
    """Create a random, unguessable ntfy topic the citizen can subscribe to."""
    topic = _TOPIC_PREFIX + secrets.token_urlsafe(_TOKEN_BYTES)
    base = base.rstrip("/")
    host = urlparse(base).netloc or base
    return NotificationChannel(
        topic=topic,
        subscribe_url=f"{base}/{topic}",
        app_url=f"ntfy://{host}/{topic}",
    )


def send_message(
    target: str, message: str, *, title: str | None = None, timeout: float = 15.0
) -> bool:
    """POST a plain-text message to a citizen-controlled link. Best-effort.

    Synchronous so it can be called from the (synchronous) MCP tools; the poller
    keeps its own async sender. ntfy turns the body into the notification text
    and the optional ``Title`` header into its title.
    """
    headers = {"Title": title} if title else None
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(target, content=message.encode("utf-8"), headers=headers)
        return resp.is_success
