# 00 - Overview

## The movement

**The Open State** is a social inclusion movement: public services should be reachable by every citizen, through the AI assistant they already use, regardless of ability, age, or language. It is not a company. Success is citizens reaching what is already theirs, and ultimately the public sector adopting this approach for all services.

**The Civic Access Protocol** is the repeatable method: how to take a public service that technically exists but practically excludes people, and turn it into something a citizen can simply ask for, safely.

This repo is the first reference implementation: Canadian campsite booking.

## Why camping, and why this shape

Public campsites are a public good that vanishes in seconds to whoever can win the booking race. That race excludes the people The Open State exists for: someone with a cognitive disability, a senior, a newcomer, anyone who cannot fight a ninety-second queue through a complex UI. The same conversational layer that helps a busy parent helps a wheelchair user who literally cannot navigate the interface under time pressure.

The shape is deliberate and constrained by the Constitution:

- The citizen keeps their government credentials. We never hold them.
- We prepare bookings; the citizen confirms them in their own session.
- It works through whatever assistant the citizen already uses.

## The build arc (milestones)

|Milestone|What                                                                                                                |Certainty                                        |
|---------|--------------------------------------------------------------------------------------------------------------------|-------------------------------------------------|
|**M1**   |Parks Canada search + alerts + prepare-booking, running locally (stdio) in the citizen’s AI assistant. Wraps camply.|Locked. Build now.                               |
|**M2**   |Hosted remote MCP + OAuth, so non-technical citizens add it as a one-click connector.                               |Detailed, with validation gates.                 |
|**M3**   |Server-side preferences/memory keyed to an Open State account, portable across assistants.                          |Medium detail.                                   |
|**M4**   |Alberta Parks provider (HTML scrape behind the same interface).                                                     |Provisional. Validate against live traffic first.|
|**M5**   |Connector directory submission and public launch.                                                                   |Provisional.                                     |

Build them in order. Do not pull later work forward. Later milestones depend on what you learn running earlier ones.

## Principles (the short version; CONSTITUTION.md is binding)

1. The citizen keeps the keys (no credential storage, ever).
1. The citizen acts, we assist (prepare, never auto-complete consequential actions).
1. The citizen chooses the tool (assistant-agnostic).
1. Accessibility is the purpose (plain language, screen-reader friendly, accessibility data first-class).
1. No exploitation (no data monetization, no lock-in, honest about limits).

## Glossary

- **MCP (Model Context Protocol):** the standard by which AI assistants call external tools. Our server speaks MCP.
- **Connector / app:** what an AI assistant calls an MCP server the citizen has added.
- **camply:** existing open-source library that reads Canadian/US campground availability. We wrap it for Parks Canada.
- **GoingToCamp / Camis:** the platform behind Parks Canada reservations.
- **Aspira:** the platform behind Alberta Parks reservations (different from Parks Canada).
- **Provider:** our internal abstraction; one per booking platform, all returning the same normalized data shape.
- **Prepare-then-confirm:** we build a complete booking and hand the citizen a deep link; they confirm and pay in their own logged-in session.
- **Civic Access Protocol compliant:** meets every MUST/MUST NOT in CONSTITUTION.md.
