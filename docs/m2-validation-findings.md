# M2 validation findings (gates G1–G3) + auth decisions

**Status: research complete (May 2026). No code written against assumptions yet.**
This closes the M2 validation gates from `docs/milestones/m2-remote-oauth.md` as far
as research can, flags what can only be confirmed at deploy time, and records the
two decisions that gate the build: **which identity provider**, and **whether to
ship an unauthenticated host first**.

Re-verify before building — connector and MCP-auth behavior changes fast (AGENTS:
"verify against current docs at build time, do not assume").

---

## G1 — One-click connector + OAuth flow

**Confirmed.** A citizen adds a custom connector by entering the server's remote
MCP URL; OAuth client id/secret are optional "Advanced settings". What our server
must expose when we *do* require auth:

- **OAuth 2.1 resource-server role only.** The MCP server validates tokens issued
  by a separate authorization server; it does not mint tokens itself (2025-11-25
  spec formally classifies MCP servers as OAuth 2.1 resource servers).
- **Protected Resource Metadata (RFC 9728) — MUST.** Publish
  `/.well-known/oauth-protected-resource` with an `authorization_servers` field.
  A request without a valid token returns **401 with a `WWW-Authenticate`** header
  pointing at that metadata.
- **PKCE S256 — MUST.** Claude sends `code_challenge_method=S256` on every
  authorization request; the auth server must advertise
  `"code_challenge_methods_supported": ["S256"]`.
- **Resource Indicators (RFC 8707) — MUST.** Tokens are audience-bound to our
  server, so we validate the audience and reject tokens minted for anything else.
- **Client registration — three options Claude supports:**
  - **CIMD (Client ID Metadata Documents)** — supported out of the box and
    *preferred for high-traffic servers*; the MCP spec is moving to CIMD as the
    default (SHOULD) with DCR as optional (MAY).
  - **DCR (Dynamic Client Registration)** — supported out of the box; simplest to
    stand up, but proliferates clients at scale.
  - **Anthropic-held credentials** — requires emailing `mcp-review@anthropic.com`.
- **Callback URLs:** hosted Claude surfaces (web, Desktop, mobile, Cowork) use
  `https://claude.ai/api/mcp/auth_callback` (may move to `claude.com`). Claude Code
  uses RFC 8252 loopback redirects (`http://localhost:<port>/callback`).

**Implication for us:** use **FastMCP's `RemoteAuthProvider`** (it composes a
`TokenVerifier` with authorization-server info and *auto-generates* the
`/.well-known/oauth-protected-resource` + discovery endpoints), pointed at an
external IdP. We do not hand-roll RFC plumbing (matches the milestone's
instruction). **Open item to confirm at build:** that the installed FastMCP
version exposes CIMD and RFC 8707 resource-indicator handling — the current
FastMCP remote-OAuth docs describe DCR-based providers and do not yet mention CIMD
by name. If CIMD isn't first-class yet, DCR is an acceptable interim (Claude
supports both), with CIMD as a fast-follow.

## G2 — Reachability from Anthropic's cloud

**Confirmed as a requirement; only fully verifiable once deployed.** Even Desktop/
Cowork connections originate **server-side from Anthropic's infrastructure**, so the
host must be **publicly reachable over HTTPS**, and the authorization server must be
reachable from Anthropic for discovery.

- **Egress range to allowlist:** `160.79.104.0/21`.
- Our `/health` route (already built) gives the platform a probe target distinct
  from `/mcp`.
- **Cannot close until a public host exists.** Action at deploy: stand the host up
  public HTTPS, confirm the connector completes discovery + a tool call from
  Anthropic's range, and (if we firewall) allowlist `160.79.104.0/21`.

## G3 — Credential-free hand-off still holds

**Confirmed by design; no code change needed, guard against drift.** M2 adds auth to
**our** service only (Layer A). It does **not** add Parks Canada / Alberta login.

- No government credentials server-side; the citizen still authenticates in their
  own browser and confirms the booking themselves (`prepare_booking_url` stays
  prepare-only).
- **No token passthrough:** the inbound MCP token is never forwarded upstream; our
  upstream calls carry only our honest User-Agent.
- Validate inbound token audience == this server (covered by G1's RFC 8707 point).

---

## Decision 1 — Identity provider (Layer A)

Layer A identity is lightweight: it exists only to key per-citizen preferences/
memory in M3. It is **not** a government identity. FastMCP splits providers two ways:

- **`RemoteAuthProvider`** for IdPs **with DCR** (WorkOS AuthKit via a dedicated
  `AuthKitProvider`, Descope, modern OIDC) — registration is automatic.
- **`OAuthProxy`** for IdPs **without DCR** (GitHub, Google, Azure, Auth0) — fixed
  app credentials, manual registration, FastMCP proxies the DCR step.

**Recommendation: WorkOS AuthKit** as the primary, Descope as the alternative.
Rationale: both are DCR-capable and MCP-oriented, AuthKit has a *dedicated FastMCP
provider class* (least integration code), and both keep us firmly in the
"resource-server only" lane. GitHub/Google/Auth0 via `OAuthProxy` work but add the
proxy hop and manual setup for no real benefit here.

**To confirm before committing:** (a) data-residency / privacy posture of the IdP
against the Constitution's data-minimization stance (the M2 host is Canada-region;
the IdP is a separate SaaS); (b) free-tier limits; (c) that the chosen provider's
FastMCP class is current in our pinned FastMCP version.

> **Needs your call:** WorkOS AuthKit (recommended), Descope, an `OAuthProxy`
> provider you already use, or self-hosted (Keycloak — more ops burden).

## Decision 2 — Ship an unauthenticated host first?

**Short answer: yes, but a *scoped* one — not the full current toolset open.**
Claude explicitly supports no-auth remote connectors (`"none"` auth type is
supported; partial-auth is experimental), so an unauthenticated host *can* be added
by URL alone. That makes it attractive for validating G2 and for an early public
utility. But three properties of the **current** code make a full open deployment
unsafe:

1. **The alert tools are global, not per-citizen.** `list_alerts` returns *every*
   saved alert and `delete_alert` works on any id. Single-user local: fine.
   Multi-tenant + unauthenticated: every citizen can see and delete everyone's
   watches. **This is the blocker.** Layer A identity is exactly what scopes alerts
   to a subject — so the alert tools effectively *need* auth (or per-session
   scoping) before multi-tenant hosting.
2. **`notify_target` is an open POST/SSRF vector when unauthenticated.**
   `create_alert` accepts an arbitrary `http(s)` URL our server then POSTs to. Open
   to the world, that is an HTTP POST relay and an SSRF path to internal/metadata
   addresses. Before any public exposure: restrict to the configured ntfy base host
   (or `"auto"`-only with our generated topics) and block private IP ranges.
3. **Upstream politeness / abuse (Constitution Art. 7.3).** On-demand `search_*`
   proxies to Parks Canada and unbounded alert creation means unbounded background
   polling. An open endpoint invites abuse that could hammer reservation.pc.gc.ca.
   Needs rate limiting and per-instance alert caps **regardless** of auth; auth adds
   accountability.

**Recommended paths (pick one):**

- **(A) Read-only public preview — lowest risk, real value.** Deploy only
  `search_parks`, `list_equipment_types`, `search_sites`, `get_site_details`,
  `prepare_booking_url` (all public data, prepare-only) with **no auth** but **rate
  limited**; disable the alert tools in this mode via a flag. Eliminates blockers 1
  and 2 entirely, validates hosting + transport + G2, and is genuinely useful to
  citizens immediately.
- **(B) Private/unlisted full instance for validation.** Full toolset, single
  trusted user, not advertised — fine because it isn't multi-tenant in practice.
  Good for dogfooding and closing G2 without building auth first.
- **(C) Wait for Layer A auth** before any alert-bearing public host. Auth scopes
  alerts per citizen and gives accountability for the rate limits.

**Enabling work this implies (small, worth doing regardless of order):** a flag to
disable/expose the alert tools per deployment; lock `notify_target` down to the
ntfy base host + block private IPs; add rate limiting. These also harden the
authenticated build later.

---

## Sources

- [MCP Authorization spec (draft)](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [Auth0 — MCP spec auth update](https://auth0.com/blog/mcp-specs-update-all-about-auth/)
- [Claude — Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- [Claude — Get started with custom connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [FastMCP — Remote OAuth](https://gofastmcp.com/servers/auth/remote-oauth)
- [WorkOS — Client ID Metadata Documents (CIMD)](https://workos.com/blog/client-id-metadata-documents-cimd-oauth-client-registration-mcp)
- [Auth0 — CIMD vs DCR for MCP](https://auth0.com/blog/cimd-vs-dcr-mcp-registration/)
- [RFC 9728 — OAuth 2.0 Protected Resource Metadata]; [RFC 8707 — Resource Indicators]; [RFC 7591 — Dynamic Client Registration]
