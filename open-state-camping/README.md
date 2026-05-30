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

- `notify_target` is an optional web link **you** control, for example an
  [ntfy.sh](https://ntfy.sh) topic URL (`https://ntfy.sh/your-private-topic`). No
  account, password, or personal information is stored — only the search and the
  link you provide.
- In M1 the poller runs **while your assistant session is open** (the server is a
  local process). Always-on watching arrives with hosting in M2.

## Configuration

All optional, via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `OPEN_STATE_TRANSPORT` | `stdio` | `stdio` (M1) or `http` (forward-looking; M2 adds hosting + auth). |
| `OPEN_STATE_ALERT_DB` | `open_state_camping_alerts.db` | SQLite path for alerts (no identity stored). |
| `OPEN_STATE_POLL_INTERVAL_MINUTES` | `10` | Alert poll interval; floored at 5. |
| `OPEN_STATE_USER_AGENT` | a browser UA | See the note below. |
| `OPEN_STATE_HTTP_TIMEOUT` | `30` | Upstream request timeout (seconds). |

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
