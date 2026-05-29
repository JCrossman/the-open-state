"""GoingToCamp / Camis platform client (used by the Parks Canada provider).

This is a thin, typed HTTP client for the booking platform behind Parks Canada
(`reservation.pc.gc.ca`). It is the only code that knows the platform's HTTP
shape; the provider above it maps platform data into the normalized
`CampingProvider` types. See docs/parks-canada-api-findings.md for the verified
endpoint contract this client implements.
"""

from open_state_camping.providers.going_to_camp.client import (
    GoingToCampClient,
    QueueItError,
    UpstreamError,
)

__all__ = ["GoingToCampClient", "QueueItError", "UpstreamError"]
