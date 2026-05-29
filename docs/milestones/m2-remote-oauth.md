# M2 - Remote hosting + OAuth (one-click connector)

**Status: detailed, with validation gates.** Build after M1 works locally. This is what turns the local tool into something a non-technical citizen can add to their assistant in one click.

## Goal

The same server, hosted, reachable as a remote MCP connector that a citizen adds through their assistant’s “add connector / add app” UI, authenticating via a consent screen. No config files, no Python on the citizen’s machine.

## What changes from M1

- **Transport:** flip the env switch to **Streamable HTTP**; serve the MCP endpoint at `/mcp`. Keep stdio working for local dev.
- **Hosting:** Azure Container Apps, Canada region, min replicas >= 1 (the alert poller and interactive sessions both need an always-on instance). Add a `/health` endpoint separate from `/mcp`.
- **Auth (Layer A only):** implement OAuth 2.1 + PKCE (S256) as an MCP-compliant resource server. Support both Dynamic Client Registration and Client ID Metadata Documents (CIMD) for broad client compatibility. Publish Protected Resource Metadata at `/.well-known/oauth-protected-resource`. Use FastMCP’s auth provider rather than hand-rolling RFC plumbing.
- **Scheduler:** move the alert poller into the ASGI lifespan as a background asyncio task (wrap FastMCP’s lifespan so its session manager still initializes). Persist alerts in managed storage, not local SQLite, so they survive redeploys.
- **Statelessness:** run `stateless_http=True` so multiple replicas do not break sessions.

## Validation gates (confirm before building)

- **G1:** Confirm the current one-click “add custom connector / add app” flow and its OAuth expectations for each target client you care about (Claude first). Client behavior here changes; verify against current docs at build time, do not assume.
- **G2:** Confirm Anthropic’s connector reaches your server from their cloud (even for Desktop/Cowork the connection originates server-side). Ensure the host is public-internet-reachable and, if required, allowlist their ranges.
- **G3:** Confirm the booking hand-off still works without any government credential on the server. M2 does NOT add government auth. The citizen still confirms in their own session.

## Hard boundaries (from the Constitution)

- M2 adds auth to OUR service only (Layer A). It does NOT add Parks Canada/Alberta login. No government credentials server-side.
- No token passthrough: never forward the inbound MCP token to any upstream.
- Validate inbound token audience == this server.

## Definition of done

1. A citizen adds the connector through their assistant’s UI and authenticates via a consent screen, no config files.
1. All M1 tools work over Streamable HTTP, hosted.
1. Alerts persist across redeploys and the poller runs always-on.
1. No government credentials touch the server; booking is still prepare-then-confirm.
1. Security review: PKCE, PRM published, audience validation, no token passthrough.

## Out of scope for M2

- Preferences/memory (M3).
- Alberta provider (M4).
- Directory submission (M5).
