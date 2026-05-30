# Open State: Camping — M1 (Parks Canada, local)

Part of **The Open State**, a reference implementation of the **Civic Access
Protocol**. This package lets a citizen reach **Parks Canada** campsite booking
through their own AI assistant, in plain language, while keeping their
credentials and their control.

> Your services. Your assistant. Your access.

This is **Milestone 1**: it runs locally and speaks MCP over **stdio**, so you add
it to an assistant on your own machine. It is read-only and **never books, pays,
or stores credentials** — it prepares a booking link you confirm yourself in your
own Parks Canada session.

See the repo root for the binding rules and design:
[`CONSTITUTION.md`](../CONSTITUTION.md), [`AGENTS.md`](../AGENTS.md),
[`docs/00-overview.md`](../docs/00-overview.md),
[`docs/01-architecture.md`](../docs/01-architecture.md),
[`docs/milestones/m1-parks-canada-local.md`](../docs/milestones/m1-parks-canada-local.md).
The verified Parks Canada API contract is in
[`docs/parks-canada-api-findings.md`](docs/parks-canada-api-findings.md).

## What it does

Eight plain-language tools, all read-only:

| Tool | Purpose |
|---|---|
| `search_parks` | Turn a place name ("Banff") into campgrounds and their ids. |
| `list_equipment_types` | List equipment types (tent, RV, …) you can filter by. |
| `search_sites` | Find open sites for a stay; **accessibility is first-class** and filterable; supports `nights` and `weekends_only`. |
| `get_site_details` | One site's accessibility, capacity, service type, amenities, photos. |
| `prepare_booking_url` | A booking deep link the citizen opens and confirms themselves. |
| `create_alert` | Watch a campground and get notified when a cancellation opens a site. |
| `list_alerts` / `delete_alert` | Manage your watches. |

Accessibility is the point: sites Parks Canada marks accessible are detected
per-site and can be filtered with `accessible_only`. Output is written to read
cleanly with a screen reader.

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)

## Setup

```bash
cd open-state-camping
uv sync
```

## Run (local, stdio)

```bash
uv run python -m open_state_camping.server
```

The server speaks MCP over stdio and waits for an assistant to connect. To poke
at the tools directly, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector uv run python -m open_state_camping.server
```

## Run (remote, HTTP) — M2, in progress

The same tools also serve over **Streamable HTTP**, the transport a hosted,
one-click connector will use. Flip the env switch:

```bash
OPEN_STATE_TRANSPORT=http OPEN_STATE_PORT=8765 uv run python -m open_state_camping.server
# MCP endpoint:  http://127.0.0.1:8765/mcp
# Liveness:      http://127.0.0.1:8765/health  -> {"status":"ok",...}
```

The alert poller runs in the server's lifespan (always-on while the process is
up), and `stateless_http` is on by default so multiple replicas won't break
sessions.

### Hosted read-only preview (live)

A read-only, unauthenticated preview is deployed to Azure Container Apps. It
exposes the five public-data, prepare-only tools (`search_parks`,
`list_equipment_types`, `search_sites`, `get_site_details`,
`prepare_booking_url`); the alert tools and the poller are turned off
(`OPEN_STATE_ENABLE_ALERTS=false`), so it scales to zero when idle and stores
nothing about anyone. Add it to Claude as a custom connector (no auth needed):

```
https://openstate-camping.thankfulsmoke-6af0ea17.canadacentral.azurecontainerapps.io/mcp
```

The first request after an idle period cold-starts the container, so it may take
a few seconds. The reasoning for keeping alerts out of the public preview — and
why a full open deployment would be unsafe without auth — is in
[`../docs/m2-validation-findings.md`](../docs/m2-validation-findings.md). The
infrastructure-as-code and deploy steps live in [`infra/`](infra/).

> **Known cosmetic warning when adding the connector.** Claude (web/desktop) may
> show *"Couldn't register with CampMCP's sign-in service… add an OAuth Client
> ID"* with an `ofid_…` reference. This is harmless: Claude's onboarding
> optimistically attempts OAuth Dynamic Client Registration, which fails because
> this preview is intentionally **unauthenticated** (it publishes no
> `/.well-known/oauth-protected-resource` and never returns a `401`), so Claude
> falls back to connecting with no auth — and the tools work. Leave the OAuth
> Client ID blank. The warning disappears once the server gains real OAuth
> (the WorkOS AuthKit build), which is also when the alert tools return behind
> login.

#### Rate limiting

Because the preview is an unauthenticated public proxy to the Parks Canada
reservation system, an HTTP deployment applies a **global** rate limit
(`OPEN_STATE_RATE_LIMIT_RPS` / `_BURST`) to stay a polite upstream guest
(Constitution Art. 7.3). The limit is a single shared bucket rather than
per-client, because all Claude connections originate from one Anthropic IP range
(`160.79.104.0/21`), so per-IP limiting would not distinguish callers. The live
preview runs at **3 req/s, burst 10** — comfortably above a normal search flow
(roughly four calls: find park → search sites → details → prepare link) while
capping abusive bursts. A flood beyond the burst receives a clear
"Global rate limit exceeded" error.

## Connect it to Claude Desktop

Add this to your `claude_desktop_config.json`, using **absolute** paths (Claude
Desktop launches the server with a minimal `PATH`), then restart Claude Desktop.

```json
{
  "mcpServers": {
    "open-state-camping": {
      "command": "/ABSOLUTE/PATH/TO/uv",
      "args": [
        "--directory", "/ABSOLUTE/PATH/TO/open-state-camping",
        "run", "python", "-m", "open_state_camping.server"
      ],
      "env": {}
    }
  }
}
```

Find your `uv` path with `which uv` (macOS/Linux) or `where uv` (Windows).

## Connect it to Claude Code

The repository root ships a [`.mcp.json`](../.mcp.json) that registers this
server for [Claude Code](https://claude.com/claude-code). Open the repo in Claude
Code and approve the `open-state-camping` server when prompted — the eight tools
load and you can drive them in plain language, the same end-to-end test as Claude
Desktop, including from the Claude Code web and mobile apps. Unlike the Desktop
config above, it uses a **relative** `--directory`, so it works for anyone who
clones the repo with no per-machine paths to edit.

### Try it

- "Find me a Parks Canada campground in Banff."
- "Any accessible sites at Tunnel Mountain Trailer Court for the August long weekend, two people?"
- "Tell me more about that site."
- "Nothing's open — watch it and let me know if a cancellation comes up."

The assistant gets a booking link; you open it, sign in to your own Parks Canada
account, choose your exact site, and confirm and pay yourself.

## Alerts

`create_alert` saves a search and the poller re-checks it on a polite schedule
(never faster than every 5 minutes, with jitter). When a site opens, the alert
is retired and — if you gave a `notify_target` — a short message with the booking
link is sent there.

- **Easiest:** ask for the watch and say you'd like to be notified — the
  assistant calls `create_alert` with `notify_target="auto"`, which provisions a
  **private, random [ntfy.sh](https://ntfy.sh) topic** for you (no sign-up), sends
  a **test message** so you can confirm it works, and hands back a subscribe link
  plus an `ntfy://` deep link that opens the ntfy phone app in one tap.
- **Bring your own:** pass an `http(s)` link **you** control (such as your own
  ntfy topic) as `notify_target`.
- Either way, no account, password, or personal information is stored — only the
  search and the link. An auto topic's random suffix is its secret: anyone who
  learns the full topic name can read or post to it, so treat the link as private.
  Point `OPEN_STATE_NTFY_BASE` at a self-hosted ntfy for stronger guarantees.
- In M1 the poller runs **while your assistant session is open** (the server is a
  local process). Always-on watching arrives with hosting in M2.

## Configuration

All optional, via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `OPEN_STATE_TRANSPORT` | `stdio` | `stdio` (M1) or `http` (Streamable HTTP for the hosted connector; M2 still adds OAuth + hosting). |
| `OPEN_STATE_ALERT_DB` | `open_state_camping_alerts.db` | SQLite path for alerts (no identity stored). |
| `OPEN_STATE_ALERT_BACKEND` | `sqlite` | Alert storage backend; managed backends arrive with M2 hosting. |
| `OPEN_STATE_POLL_INTERVAL_MINUTES` | `10` | Alert poll interval; floored at 5. |
| `OPEN_STATE_USER_AGENT` | a browser UA | See the note below. |
| `OPEN_STATE_HTTP_TIMEOUT` | `30` | Upstream request timeout (seconds). |
| `OPEN_STATE_NTFY_BASE` | `https://ntfy.sh` | Base URL for auto-provisioned notification topics; set to a self-hosted ntfy for privacy. |
| `OPEN_STATE_HOST` / `OPEN_STATE_PORT` | `127.0.0.1` / `8000` | Bind address for `http` transport. |
| `OPEN_STATE_MCP_PATH` | `/mcp` | Path the MCP endpoint is served at (`http` transport). |
| `OPEN_STATE_STATELESS_HTTP` | `true` | Stateless HTTP so multiple replicas don't break sessions. |
| `OPEN_STATE_ENABLE_ALERTS` | `true` | When `false`, the alert tools are hidden and the poller does not run — used for the unauthenticated read-only preview. |
| `OPEN_STATE_RATE_LIMIT_RPS` | `5` | Global requests/sec for the `http` transport (`<= 0` disables). A single shared bucket: all Claude traffic arrives from one IP range, so the limit is global, not per-client. |
| `OPEN_STATE_RATE_LIMIT_BURST` | `20` | Burst capacity above the steady rate. |

## Tests

```bash
uv run pytest
```

Tests run fully offline against recorded fixtures — no live network calls.

## Honest notes and known limits

Reality, recorded rather than guessed (Constitution Art. 7):

- **Price is not shown.** Parks Canada's API exposes no read-only price; a price
  only exists as a cart/checkout line item, which would mean entering the booking
  flow — something this tool deliberately does not do. You see the price in your
  own session via the prepared link. (Details in the findings doc.)
- **No per-site loop name.** Not wired in M1.
- **User-Agent tension.** Parks Canada returns HTTP 403 to non-browser
  User-Agents, so the default UA is browser-like to function. This sits awkwardly
  with "honest identification" (Art. 7.3); it is configurable and is a candidate
  for resolution through an official relationship (the Track-2 goal).
- **camply is not used at runtime.** The locked stack could not run camply and
  FastMCP together (incompatible Pydantic versions), and camply's Parks Canada
  path is in any case stale (the endpoint it relied on was removed upstream). We
  implement a small, verified client of our own; camply's source was the
  reference. See the findings doc.

## What's next

- **M2** — hosted remote MCP (Streamable HTTP) + OAuth one-click connector.
- **M3** — cross-assistant preferences and memory.
- **M4** — Alberta Parks behind the same provider interface.

*No citizen should be excluded from what is already theirs.*
