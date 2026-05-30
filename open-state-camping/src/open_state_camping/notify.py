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

import ipaddress
import secrets
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from open_state_camping.config import Config
from open_state_camping.providers.base import InvalidInputError
from open_state_camping.tls import verify_setting

# A recognizable prefix plus a random suffix: the suffix keeps the full topic
# unguessable, which is what makes an open ntfy topic effectively private.
_TOPIC_PREFIX = "openstate-"
_TOKEN_BYTES = 12


def allowed_notify_hosts(config: Config) -> frozenset[str]:
    """Hosts a citizen-supplied notify_target may point at.

    Always includes the configured ntfy base host (so ``auto`` channels and a
    citizen's own ntfy topic work) plus any operator-configured extra hosts.
    """
    hosts = {urlparse(config.ntfy_base).hostname or ""}
    hosts.update(config.notify_allowed_hosts)
    return frozenset(h.lower() for h in hosts if h)


def validate_notify_target(target: str, allowed_hosts: frozenset[str]) -> None:
    """Reject a notification link we must not POST to, with a plain-language reason.

    Two protections, because an unauthenticated host turns ``create_alert`` into
    an HTTP POST primitive (docs/m2-validation-findings.md, decision 2):
    - **No open relay:** the host must be one of ``allowed_hosts`` (the ntfy base
      host by default), so the server can't be used to POST to arbitrary sites.
    - **No SSRF:** an IP-literal target in a private, loopback, link-local, or
      otherwise non-global range is refused, so it can't reach internal services
      or the cloud metadata endpoint (169.254.169.254).
    Raises ``InvalidInputError`` (whose message is shown to the citizen) on a bad
    target; returns ``None`` when the target is safe to use.
    """
    parsed = urlparse(target)
    host = parsed.hostname
    if parsed.scheme not in ("http", "https") or not host:
        raise InvalidInputError(
            "The notification link must be a web address starting with http:// "
            "or https:// that you control, such as an ntfy.sh topic link. You can "
            'also say "auto" and I will set up a private channel for you, or set '
            "an alert without one and check back with list_alerts."
        )
    host = host.lower()
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and not ip.is_global:
        raise InvalidInputError(
            "That notification link points at a private or internal address, so I "
            "will not send to it. Use a public notification service such as an "
            'ntfy.sh topic, or say "auto" and I will set up a private channel.'
        )
    if host not in allowed_hosts:
        allowed = ", ".join(sorted(allowed_hosts)) or "the configured ntfy host"
        raise InvalidInputError(
            f"For safety I only send notifications to {allowed}. Say \"auto\" and "
            "I will set up a private channel for you, or set an alert without a "
            "link and check back with list_alerts."
        )


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
    with httpx.Client(timeout=timeout, verify=verify_setting()) as client:
        resp = client.post(target, content=message.encode("utf-8"), headers=headers)
        return resp.is_success
