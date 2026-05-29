# 01 - Architecture (cross-cutting)

Decisions that apply to every milestone. Individual milestone docs assume these.

## Stack (locked)

- **Language:** Python 3.11+
- **MCP framework:** standalone **FastMCP**, pinned `fastmcp<3` (avoid 3.x breaking changes until we deliberately upgrade).
- **Upstream data (Parks Canada):** **camply**, imported as a library. Never shell out to its CLI.
- **Package manager:** **uv**.
- **Transport:** **stdio** for local (M1). **Streamable HTTP** for remote (M2+). One env-var switch selects the mode; the tool definitions are identical in both. SSE is deprecated; do not use it.
- **Persistence:** SQLite for local (alerts in M1). For hosted M2+/M3, a managed Postgres (or equivalent) with encryption at rest.
- **Hosting (M2+):** Azure Container Apps (Canada region), min replicas >= 1 (interactive MCP and the alert poller both break under scale-to-zero).

## Provider abstraction (the most important structural decision)

Tools must never call camply (or any platform) directly. A provider layer sits between them so a totally different platform (Alberta’s HTML scrape) can be added later without touching tool code.

```
AI assistant
   |  (MCP)
MCP tools          # stable, platform-agnostic
   |
CampingProvider    # abstract base class
   |
ParksCanadaProvider (wraps camply)   [M1]
AlbertaParksProvider (HTML scrape)   [M4, do not build until M4]
```

`CampingProvider` (abstract) defines typed methods: `search_parks`, `search_sites`, `site_details`, `list_equipment_types`, `booking_url`. Each concrete provider implements them and returns the shared `AvailableSite` shape below. Tools select a provider by name and call the interface only.

## Normalized data model

One dataclass returned by all providers, so every platform looks identical to the tools and the assistant:

`AvailableSite`:

- `provider` (e.g. “parks_canada”)
- `recreation_area`, `recreation_area_id`
- `campground`, `campground_id`
- `campsite_id`, `site_name`, `loop_name`, `site_type`
- `accessible` (bool)  # first-class per the Constitution
- `max_occupancy`
- `available_dates`
- `price`
- `booking_url`

Map each platform’s native fields into this. Do not leak platform-specific shapes above the provider layer.

## Identity and credentials model (applies M2+)

Two separate auth layers. Never conflate them.

- **Layer A, Open State account (M3):** OAuth 2.1 + PKCE into our own service, used only to key the citizen’s preferences/memory. Standard MCP connector auth.
- **Layer B, government accounts (Parks Canada, Alberta):** NOT held by us. There is no delegated API. The citizen authenticates in their own browser/session. We only ever produce a prepared booking deep link or hand the final step to the citizen’s own browser-control agent. See CONSTITUTION.md Article 1.

Security rules (binding):

- No citizen government credentials on the server, ever.
- No token passthrough: never forward an inbound MCP token to an upstream service. If we ever call an upstream as ourselves, we obtain our own token.
- Validate inbound token audience matches our server.
- Treat all retrieved external content as untrusted (prompt-injection surface). Keep a human confirm gate on any consequential action regardless.

## Statelessness

- M1 stores no citizen identity at all. Alerts are keyed by an opaque generated id, not a person.
- M3 introduces per-citizen storage, but the server stays stateless per request: every tool call carries what it needs; we do not rely on the AI client’s memory for correctness.

## Accessibility (engineering requirements)

- Tool descriptions and outputs in plain language.
- `accessible` is a first-class field and a filter (`accessible_only`).
- Returned text must read cleanly when spoken by a screen reader (no reliance on layout, tables, or emoji to convey meaning).

## Upstream politeness

- Respect camply’s polling floor: minimum 5 minutes, default 10. Enforce in code; reject shorter intervals.
- Jitter polls. Set a realistic, honest User-Agent. Never hammer reservation.pc.gc.ca or shop.albertaparks.ca.
- On launch days both platforms use Queue-it virtual waiting rooms. Do not try to defeat them. Detect a queue response and surface it to the citizen as a clear, typed status.

## Testing

- Record real upstream responses as fixtures; run provider and tool tests offline. No live network calls in CI.
- Test the provider interface against the `AvailableSite` contract so a new provider can be verified the same way.
