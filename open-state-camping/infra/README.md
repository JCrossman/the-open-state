# Infrastructure — read-only public preview (M2, option A)

Infrastructure-as-code for the unauthenticated, read-only preview described in
[`../../docs/m2-validation-findings.md`](../../docs/m2-validation-findings.md)
(decision 2 / option A). It deploys the public-data, prepare-only MCP tools to
Azure Container Apps; the alert tools and the background poller are disabled, so
the service scales to zero when idle.

## What gets created (single resource group)

| Resource | Purpose |
|---|---|
| Log Analytics workspace | Container Apps logs |
| Container Apps managed environment | Runtime for the app |
| Azure Container Registry (Basic, **no admin user**) | Holds the image |
| User-assigned managed identity (+ AcrPull) | Lets the app pull from ACR **without a password** |
| Container App | The preview; HTTPS ingress, `/health` probes, scale-to-zero |

## Security notes

- **No secrets in the template or the repo.** Image pulls use the managed
  identity, not a registry password (`adminUserEnabled: false`).
- HTTPS terminates at the ingress (`allowInsecure: false`).
- No government credentials touch this service (Constitution Art. 1); only
  read-only, prepare-only tools are exposed (`OPEN_STATE_ENABLE_ALERTS=false`).
- A global rate limit (`OPEN_STATE_RATE_LIMIT_RPS`/`_BURST`) protects the upstream
  reservation system (Art. 7.3).

## Deploy

Prereqs: `az login` with rights on the target subscription; run from the project
directory (`open-state-camping/`) so the Docker build context is correct.

```bash
RESOURCE_GROUP=rg-open-state-preview LOCATION=canadacentral ./infra/deploy.sh
```

The script is two-phase and idempotent: it provisions the infra (with a
placeholder image so the ACR exists), builds the image **in ACR** with
`az acr build` (no local Docker needed), then redeploys the app onto the real
image. It prints the public URL, `/health`, and the `/mcp` endpoint.

### Recommended guardrails (operator)

- Put a **budget alert** on the resource group before deploying.
- Deploy with a **service principal scoped to this resource group** rather than a
  full-subscription login; rotate it afterward.

## After deploy

1. Hit `https://<fqdn>/health` — expect `{"status":"ok",...}`.
2. Confirm the MCP endpoint lists the **five** read-only tools (no alert tools).
3. Add `https://<fqdn>/mcp` as a custom connector in Claude (no auth).
4. Anthropic connects from `160.79.104.0/21`; the ingress is public, so no
   allowlist is needed unless you add a firewall.

## Files

- `main.bicep` — all resources (validate with `bicep build infra/main.bicep`).
- `deploy.sh` — provision + build + deploy.
