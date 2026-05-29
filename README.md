# The Open State: Camping (Civic Access Protocol reference implementation)

**Your services. Your assistant. Your access.**

This repository is the first reference implementation of the **Civic Access Protocol**, under the movement **The Open State**: making public services reachable by every citizen, through the AI assistant they already use, regardless of ability, age, or language.

The first service is Canadian campsite booking: Parks Canada first, Alberta Parks later. A citizen asks their assistant, in plain language, for the camping they want; the tool searches, filters for accessibility, watches for openings, and prepares a booking the citizen confirms themselves. The citizen keeps their credentials and their control throughout.

## Start here

- **CONSTITUTION.md** - the binding commitments. Any implementation must meet these. Also published on the website.
- **AGENTS.md** - entry point for coding agents (Claude Code, Copilot).
- **docs/00-overview.md** - the movement, the arc, the glossary.
- **docs/01-architecture.md** - cross-cutting technical decisions.
- **docs/milestones/** - build one at a time, starting with M1.

## Milestones

1. **M1** - Parks Canada search + alerts + prepare-booking, local (stdio). Locked, build now.
1. **M2** - Hosted remote MCP + OAuth one-click connector.
1. **M3** - Cross-assistant preferences and memory.
1. **M4** - Alberta Parks provider (provisional, validate first).
1. **M5** - Directory submission and public launch.

## What this is not

Not a company. Not a data business. Not a new app citizens are forced to use. It is public-interest assistive infrastructure, meant to be shared and forked, and ultimately adopted by the public sector itself.

*No citizen should be excluded from what is already theirs.*
