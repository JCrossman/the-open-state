# M3 - Preferences and memory

**Status: medium detail.** Build after M2. This is the cross-assistant memory that makes the experience personal and portable.

## Goal

A citizen’s preferences (favorite parks, equipment type, accessibility needs, usual party size, typical trip dates, saved searches, trip history) persist server-side, keyed to their Open State account from M2, and are available no matter which assistant they connect from. This is the thing each AI vendor’s own memory cannot do, because vendor memory does not transfer between Claude, ChatGPT, and Copilot.

## Tools to add

- `get_preferences()`
- `update_preferences(...)` (named fields; partial updates allowed)
- `save_search(...)` / `list_saved_searches()` / `delete_saved_search(id)`
- `save_trip(...)` / `list_trip_history()`

Tools read/write only the authenticated citizen’s own records (row-level isolation by the Layer A identity).

## Data and security (binding)

- Store keyed to the citizen’s Open State OAuth identity. Encrypt at rest. Isolate per citizen.
- **Accessibility needs are sensitive data.** Heightened protection; used only to serve the citizen’s request; never for any other purpose; never shared or sold (Constitution Articles 5 and 6).
- Provide view, export, and delete for all stored citizen data (Article 5.3).
- Collect the minimum needed. Do not store anything the tools do not use.

## How memory feeds search

`search_sites` and `create_alert` should be able to draw defaults from stored preferences when the citizen does not specify them (for example, defaulting `accessible_only=True` for a citizen who has set that need), while still letting any call override them explicitly. Keep tools correct without memory: preferences are defaults, not requirements.

## Validation gates

- **G1:** Confirm the M2 identity is stable and unique per citizen across assistants before keying data to it.
- **G2:** Confirm export/delete flows actually remove all copies (including any in the alert store) before launch.

## Definition of done

1. Preferences persist and are visible across two different assistants connected to the same Open State account.
1. Accessibility needs are stored with heightened protection and drive sensible search defaults.
1. View / export / delete all work and are complete.
1. Tools remain correct if a citizen has no stored preferences.

## Out of scope for M3

- Alberta provider (M4).
- Directory submission (M5).
