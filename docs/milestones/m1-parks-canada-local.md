# M1 - Parks Canada, local (stdio)

**Status: locked. Build this first.** Assumes `docs/01-architecture.md`.

## Goal

From the citizen’s AI assistant (test in Claude Desktop), a person can search Parks Canada campsites in plain language, filter for accessibility, get a prepared booking deep link they confirm themselves, and set a cancellation alert. No login, no booking on the server, no stored identity.

## Tools

Each needs an action-oriented docstring (“Use this when…”). Annotate read-only tools with `readOnlyHint`.

|Tool                                                                                                                                                             |Purpose                                                                                                                                            |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
|`search_parks(query, country="CA")`                                                                                                                              |Resolve a park/region name to a recreation-area id. Wraps camply `find_recreation_areas`.                                                          |
|`list_equipment_types(recreation_area_id)`                                                                                                                       |Return valid equipment ids for that rec area (they are per-area negative integers).                                                                |
|`search_sites(recreation_area_id, campground_id, start_date, end_date, party_size, equipment_type=None, accessible_only=False, nights=None, weekends_only=False)`|Find available sites. GoingToCamp requires BOTH rec-area id AND campground id; one rec area per search; run camply with `continuous=False`.        |
|`get_site_details(recreation_area_id, campsite_id)`                                                                                                              |Photos, amenities, accessibility info, description.                                                                                                |
|`prepare_booking_url(recreation_area_id, campground_id, campsite_id, start_date, end_date, party_size, equipment_type=None)`                                     |Return a reservation.pc.gc.ca deep link with the search/site prefilled. NEVER books.                                                               |
|`create_alert(recreation_area_id, campground_id, start_date, end_date, party_size, equipment_type=None, accessible_only=False, nights=None, weekends_only=False, notify_target=None)`|Persist a watch (SQLite). Poller checks on the camply interval and notifies the citizen’s own link. `notify_target="auto"` provisions a private ntfy.sh channel and sends a test ping; only the link is stored. No identity stored; key by opaque id.|
|`list_alerts()` / `delete_alert(alert_id)`                                                                                                                       |Manage watches.                                                                                                                                    |

Out of scope for M1 tools: anything that logs in, books, pays, or stores a citizen profile.

## camply integration (verify against source, do not guess)

Imports: `from camply.search import SearchGoingToCamp`, `from camply.providers import GoingToCamp`, `from camply.containers import AvailableCampsite, SearchWindow`.

Facts to honor:

- GoingToCamp requires both rec-area id and campground id; single rec area per search.
- Equipment ids are per-rec-area negative integers; discover via `GoingToCamp().list_equipment_types(rec_area_id)`.
- Polling floor is 5 minutes (default 10). Enforce in `create_alert` and the poller.

**Two identifiers you MUST confirm in camply source before trusting them** (not reliably documented):

1. the exact `SearchGoingToCamp` kwarg for equipment (`equipment` vs `equipment_id`);
1. the exact method/format for generating the booking URL.
   Open `camply/search/search_going_to_camp.py` and `camply/providers/going_to_camp/going_to_camp_provider.py`, read the real signatures, and match the wrapper to them. If reality differs from this doc, reality wins; flag it.

## Provider mapping

`ParksCanadaProvider(CampingProvider)` implements the interface from `01-architecture.md` and maps camply’s `AvailableCampsite` into `AvailableSite`. Tools call the provider, never camply.

## Project structure

```
open-state-camping/
  pyproject.toml
  README.md
  AGENTS.md                 # points to /docs
  .github/copilot-instructions.md   # one line: see AGENTS.md
  CLAUDE.md                 # one line: see AGENTS.md
  src/open_state_camping/
    __init__.py
    server.py               # FastMCP app, tools, transport switch
    config.py               # env vars (transport, db path, poll interval)
    providers/
      __init__.py
      base.py               # CampingProvider ABC + AvailableSite dataclass
      parks_canada.py       # wraps camply
    alerts/
      __init__.py
      store.py              # SQLite, no identity
      poller.py             # asyncio loop, 5-min floor, jitter
  tests/
    test_parks_canada_provider.py
    test_tools.py
    fixtures/
```

## Setup

```bash
uv init open-state-camping && cd open-state-camping
uv add "fastmcp<3" camply
uv add --dev pytest
uv run python -m open_state_camping.server          # run (stdio)
npx @modelcontextprotocol/inspector uv run python -m open_state_camping.server   # test
```

Claude Desktop `claude_desktop_config.json` (absolute paths; Claude launches with a minimal PATH):

```json
{
  "mcpServers": {
    "open-state-camping": {
      "command": "/ABSOLUTE/PATH/TO/uv",
      "args": ["run", "python", "-m", "open_state_camping.server"],
      "env": {}
    }
  }
}
```

## Definition of done

1. “Find me a campsite in <park> for <dates>, <party size>” returns real results in Claude Desktop.
1. `accessible_only` works; accessibility info appears in output in plain language.
1. `prepare_booking_url` returns a working reservation.pc.gc.ca deep link; the server never books.
1. `create_alert` persists; poller respects the 5-minute floor; a hit notifies the citizen’s own channel.
1. Tools call the provider interface, not camply. A second provider could be added without touching tool code.
1. Tests pass offline using fixtures; no live calls in CI.

## Build order

provider `base.py` -> `parks_canada.py` (+ tests vs fixtures) -> tools in `server.py` -> alerts (`store.py`, `poller.py`) -> Claude Desktop smoke test.
