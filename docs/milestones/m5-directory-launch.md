# M5 - Directory submission and launch

**Status: provisional.** Requirements for connector directories change; verify each against current docs at submission time. Build after M2 at the earliest (a hosted, authenticated connector is a prerequisite), ideally after M3 so the experience is personal.

## Goal

Make the connector discoverable and one-click for everyday citizens through the AI assistants’ own directories, and launch publicly under The Open State.

## Prerequisites

- Hosted remote MCP with OAuth (M2).
- Plain-language, accessible tool descriptions and outputs (Constitution Article 3).
- A published privacy policy (legal prerequisite and a directory requirement).
- PIPEDA / Alberta PIPA compliance posture: Privacy Officer named, data-minimization, encryption at rest, breach plan, view/export/delete (from M3).

## Channels (verify current requirements at submission time)

- **Anthropic Connectors Directory:** Streamable HTTP; OAuth with user consent; tool annotations (readOnly/destructive); privacy policy; working example prompts; a test account with sample data; documentation. Manual review.
- **ChatGPT app directory:** developer/business identity verification; published privacy policy; reachable server with test credentials (no MFA on the demo account); defined CSP; note consumer availability gaps by region.
- **Microsoft 365 Copilot:** enterprise/admin-consent path, not consumer one-click. Treat as a separate, organization-facing track; deprioritize for the citizen launch.

## Validation gates

- **G1:** Each directory’s current requirements (they change). Re-read the docs the week you submit.
- **G2:** Accessibility review with an actual screen reader and, if possible, with members of the communities this serves.
- **G3:** Privacy/legal sign-off (Canadian counsel) on the prepare-then-confirm flow and the privacy policy.

## Definition of done

1. Listed and one-click installable in at least the Anthropic directory.
1. Privacy policy published; compliance posture documented.
1. Accessibility verified with assistive technology.
1. Public launch under The Open State, with clear disclosure that the project is independent of (not endorsed by) Parks Canada and Alberta Parks unless an official partnership exists.

## After launch

This is the moment for the Track 2 conversation: bring the working, citizen-tested tool to government, and offer the Civic Access Protocol as the pattern for making all services reachable. The strongest possible pitch is a thing that already works and citizens already use.
