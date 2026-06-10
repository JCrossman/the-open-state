# Open State: Camping — Parks Canada

Part of **The Open State**, a reference implementation of the **Civic Access
Protocol**. This lets a citizen reach **Parks Canada** reservations through their
own AI assistant, in plain language, while keeping their credentials and their
control.

> Your services. Your assistant. Your access.

It is a **local MCP bundle** (`.mcpb`) you add to your assistant on your own
machine. It runs over **stdio**, searches Parks Canada's public availability, and
**prepares** a booking right up to the payment screen in *your own* session — it
**never pays, and never stores your government credentials**. You confirm and pay
yourself.

See the repo root for the binding rules and design:
[`CONSTITUTION.md`](../CONSTITUTION.md), [`AGENTS.md`](../AGENTS.md),
[`docs/00-overview.md`](../docs/00-overview.md),
[`docs/01-architecture.md`](../docs/01-architecture.md). The verified Parks Canada
API contract is in
[`docs/parks-canada-api-findings.md`](docs/parks-canada-api-findings.md).

## What it does

All four Parks Canada booking families — **search and book, end-to-end**:

| Family | Search | Prepare booking |
|---|---|---|
| Frontcountry campsites & group sites | ✅ | ✅ |
| Accommodations (oTENTik, cabin, yurt, …) | ✅ | ✅ |
| Day Use (shuttles, parking, guided events) | ✅ | ✅ |
| Backcountry zone permits (entry point + per-night zones) | ✅ | ✅ |

Plain-language tools, grouped:

- **Search / discovery:** `search_parks`, `search_park_availability`,
  `search_sites` (with a `category` of campsite / group / accommodation),
  `search_day_use`, `search_backcountry`, `get_site_details`,
  `list_equipment_types`, `resolve_dates`.
- **Account (your session):** `connect_account` opens *your own* browser to sign in
  yourself; the session is stored encrypted in a local vault. `disconnect_account`,
  `connection_status`.
- **Booking:** `prepare_booking` assembles the cart and drives it to the **payment
  screen** — you review and pay. It never pays on its own (Constitution Art. 2).
- **Alerts:** `create_alert` / `list_alerts` / `delete_alert` — watch a campground
  and get pinged when a cancellation opens a site.
- **Policies:** `get_reservation_policies` — Parks Canada's reservation rules in
  plain language (fees, change/cancel deadlines and refunds, check-in times,
  no-shows, and that park entry isn't included). The assistant also surfaces the key
  deadline and fee right in the booking preview, so you confirm with the terms in
  front of you.

**Accessibility is the point.** Where Parks Canada exposes an accessibility
attribute, sites are flagged per-site and filterable (`accessible_only`); output
is written to read cleanly with a screen reader (Constitution Art. 3).

## Build

Part of the repo-root pnpm workspace: `packages/core` (provider, booking cart,
availability) and `packages/bundle` (the MCP server + the `.mcpb`), on
[`@open-state/kit`](../kit) for the session vault and citizen-driven sign-in.

```bash
# at the repository root
pnpm install
pnpm -r build
```

## Run (local, stdio)

```bash
node packages/bundle/dist/server.js
```

The server speaks MCP over stdio and waits for an assistant to connect.

## Install in Claude Desktop (the .mcpb)

Build the bundle, then install it as a desktop extension:

```bash
# from open-state-camping/
pnpm --filter @open-state/bundle build
node packages/bundle/scripts/build-mcpb.mjs
pnpm dlx @anthropic-ai/mcpb pack packages/bundle/.mcpb-build packages/bundle/open-state-camping.mcpb
```

In **Claude Desktop → Settings → Extensions**, install
`packages/bundle/open-state-camping.mcpb` and restart. (When upgrading, remove the
old version first, then install the new one.)

## Connect it to Claude Code

The repo root ships a [`.mcp.json`](../.mcp.json) that registers the built bundle
for [Claude Code](https://claude.com/claude-code) with a **relative** path (works
for anyone who clones the repo). Build first (`pnpm -r build`), open the repo in
Claude Code, and approve the `open-state-camping` server when prompted.

### Try it

- "Find me a Parks Canada campground in Banff."
- "Any accessible sites at Two Jack Lakeside for the August long weekend, two people?"
- "Find a cabin or oTENTik in PEI for mid-September."
- "Moraine Lake shuttle times for July 17, party of 2."
- "Search Forillon backcountry for Aug 28 — then prepare Lean-to Les Lacs via Le Portage trailhead."
- "Nothing's open — watch it and let me know if a cancellation comes up."
- "What's the cancellation policy if I book a cabin and have to back out?"

To book: ask the assistant to **prepare** it; it opens *your* cart at the Parks
Canada payment screen, where you sign in (if you haven't via `connect_account`),
review, and pay yourself.

## Alerts

`create_alert` saves a search and the in-process poller re-checks it on a polite
schedule (never faster than every 5 minutes). When a site opens, the watch is
retired and — if you gave a `notify_target` — a short message is sent there.

- **Easiest:** ask to be notified — the assistant calls `create_alert` with
  `notify_target="auto"`, which provisions a **private, random
  [ntfy.sh](https://ntfy.sh) topic** (no sign-up), sends a **test message**, and
  hands back a subscribe link plus an `ntfy://` app deep link.
- **Bring your own:** pass an `http(s)` ntfy link **you** control as `notify_target`
  (for safety, links must be on an allowed notification host — not an arbitrary
  site — to prevent SSRF/open-relay abuse).
- No account, password, or personal information is stored — only the search and the
  link. An auto topic's random suffix is its secret; treat the link as private, or
  point `OPEN_STATE_NTFY_BASE` at a self-hosted ntfy.
- **Local limitation:** the bundle runs as a local stdio process, so the poller
  checks **only while your assistant is connected** to it. The watch persists on
  disk; notifications fire only while a session is live.

## Configuration

All optional, via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `OPEN_STATE_HOME` | `~/.open-state-camping` | Local dir for the encrypted session vault and the alerts file. |
| `OPEN_STATE_USER_AGENT` | a browser UA | See the honest note below. |
| `OPEN_STATE_HTTP_TIMEOUT_MS` | `30000` | Upstream request timeout (ms). |
| `OPEN_STATE_POLL_INTERVAL_MINUTES` | `10` | Alert poll interval; floored at 5. |
| `OPEN_STATE_MAX_ALERTS` | `25` | Max concurrent cancellation watches. |
| `OPEN_STATE_NTFY_BASE` | `https://ntfy.sh` | Base for auto-provisioned notify topics; set to a self-hosted ntfy for privacy. |
| `OPEN_STATE_NOTIFY_ALLOWED_HOSTS` | (none) | Extra hosts a citizen-supplied `notify_target` may point at, comma-separated. |

## Tests

```bash
pnpm -r test
```

Tests run fully offline against recorded fixtures — no live network calls. Booking
carts are diffed key-for-key against real captured sessions.

## Honest notes and known limits

Reality, recorded rather than guessed (Constitution Art. 7):

- **Price is not shown.** Parks Canada exposes no read-only price; a price only
  exists as a cart/checkout line item — which is the payment step this tool stops
  before. You see the price in your own session.
- **User-Agent tension.** Parks Canada returns HTTP 403 to non-browser
  User-Agents, so the default UA is browser-like to function. This sits awkwardly
  with "honest identification" (Art. 7.3); it is configurable and is a candidate
  for resolution through an official relationship.
- **Backcountry `availability` is a status, not a count** — `0` means available
  (like frontcountry). Booking carts differ by family (site vs quota-zone holds);
  all are matched to real captured sessions. See the findings doc.

## What's next

- Cross-assistant preferences and memory.
- Additional providers (e.g. Alberta Parks) behind the same provider interface.

*No citizen should be excluded from what is already theirs.*
