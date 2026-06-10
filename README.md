# The Open State (the Civic Access Protocol)

**Your services. Your assistant. Your access.**

This repository is the home of the **Civic Access Protocol**, under the movement **The Open State**: making public services reachable by every citizen, through the AI assistant they already use, regardless of ability, age, or language. It holds the binding **Constitution**, the **@open-state/kit** library that embodies it in code, and the first reference implementation (Parks Canada camping).

A citizen asks their assistant, in plain language, for what they need from a public service; the implementation searches, filters for accessibility, and *prepares* the action — the citizen confirms and completes it themselves. The citizen keeps their credentials and their control throughout.

## What's in this repository

| Piece | What it is |
|---|---|
| [`CONSTITUTION.md`](CONSTITUTION.md) | The binding commitments. Any implementation must meet these. |
| [`CONFORMANCE.md`](CONFORMANCE.md) | How a project declares and inherits conformance — including the `AGENTS.md` stanza new projects paste in. |
| [`kit/`](kit) — **@open-state/kit** | The Constitution's code embodiment: encrypted on-device session vault (Art. 1), the two-phase human-confirm gate (Art. 2), citizen-driven browser sign-in (Art. 10). Shared by every Open State implementation. |
| [`open-state-camping/`](open-state-camping) | The first reference implementation: Parks Canada camping, end-to-end (all four booking families), as a local `.mcpb` MCP bundle. |

Other implementations (more public services) live in their own repositories, pin a Constitution version, and consume the kit — see [`CONFORMANCE.md`](CONFORMANCE.md).

## Start here

- **CONSTITUTION.md** - the binding commitments. Any implementation must meet these. Also published on the website.
- **CONFORMANCE.md** - how to build a conformant implementation on the kit.
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
