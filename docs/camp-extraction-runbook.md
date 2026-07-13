# Runbook — Extract Camp MCP to `JCrossman/can-fed-camp-mcp`

**Status: verified.** The standalone layout below was built and tested end-to-end
in a prep session: `pnpm -r build` clean, **125 tests pass** (core 75 + bundle 50),
`.mcpb` packs as `open-state-camping.mcpb`, with `@open-state/kit` pulled
from **npm `^0.2.0`** (no workspace link). Execute in a session that has BOTH
`JCrossman/the-open-state` and `JCrossman/can-fed-camp-mcp` as sources.

The new repo should be **empty** (no auto-init README/license) so the
history-preserving push lands on a clean `main`.

> **Review note (2026-07-13).** Verified against the live repos and corrected:
> the Phase 3 README fix-list was missing the two `../docs/*` links (they point at
> the-open-state repo-root docs that the subtree split does **not** carry); the
> "keep the Releases link" instruction actually needs a repo repoint (the link is
> hardcoded to `the-open-state`, but Phase 4 releases on `can-fed-camp-mcp`); and
> Phase 2 now says explicitly to commit the generated `pnpm-lock.yaml` (CI runs
> `--frozen-lockfile`). Confirmed sound: `@open-state/kit@0.2.0` is published on
> npm, the 35-commit subtree, the `../../../`→`../../` tsconfig depth fix (only the
> two `packages/*/tsconfig.json` files match), and `manifest.json` == bundle
> `0.17.0` (the `build-mcpb.mjs` version guardrail passes).

---

## Phase 1 — Push Camp (with history) to the new repo

Run from a clone of `the-open-state`:

```bash
cd the-open-state
# Deterministic, history-preserving split of the camp subtree (35 commits):
git subtree split -P open-state-camping -b camp-extract
```

That `camp-extract` branch's root is: `packages/`, `scripts/`, `docs/`,
`README.md`, `.gitignore`. It does NOT include workspace root config (that lived
at the monorepo root) — Phase 2 adds it.

Push it as the new repo's `main`:

```bash
git push https://github.com/JCrossman/can-fed-camp-mcp.git camp-extract:main
```

(In the new session, use whatever remote/clone of `can-fed-camp-mcp` you have;
the point is `camp-extract` → `main`.)

---

## Phase 2 — Make it a standalone workspace

Clone `can-fed-camp-mcp`, then add/edit these files at the repo root.

### NEW: `package.json` (workspace root)
```json
{
  "name": "can-fed-camp-mcp",
  "version": "0.17.0",
  "private": true,
  "description": "The Open State: Camping — a local MCP for accessible Parks Canada campsite search and booking. Conforms to the Civic Access Protocol.",
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck"
  }
}
```

### NEW: `pnpm-workspace.yaml`
```yaml
packages:
  - "packages/*"
```

### NEW: `tsconfig.base.json` (verbatim copy from the-open-state root)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

### EDIT: fix tsconfig depth (packages are now 2 levels under root, not 3)
```bash
sed -i 's#\.\./\.\./\.\./tsconfig.base.json#../../tsconfig.base.json#' \
  packages/core/tsconfig.json packages/bundle/tsconfig.json
```

### EDIT: swap the kit dependency from workspace link to the npm release
In `packages/bundle/package.json`, change:
```
"@open-state/kit": "workspace:*"   ->   "@open-state/kit": "^0.2.0"
```
(Leave `"@open-state/core": "workspace:*"` — core stays an internal package.)

### Verify
```bash
pnpm install         # generates a fresh lockfile, pulls @open-state/kit from npm
pnpm -r build        # tsc — expect core + bundle "Done"
pnpm -r test         # expect core 75 + bundle 50 passing
# .mcpb pack sanity:
( cd packages/bundle && node scripts/build-mcpb.mjs && \
  pnpm dlx @anthropic-ai/mcpb pack .mcpb-build open-state-camping.mcpb )
```

Commit these as the first "standalone" commit — **including the `pnpm-lock.yaml`
that `pnpm install` just generated.** Phase 3 CI and the release workflow both run
`pnpm install --frozen-lockfile`, which fails if the lockfile is absent or stale.

---

## Phase 3 — Repo tooling (CI, release, conformance)

### `.github/workflows/ci.yml`
```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - name: Install (frozen lockfile)
        run: pnpm install --frozen-lockfile
      - name: Build (tsc — also typechecks)
        run: pnpm -r build
      - name: Test (offline, fixture-backed)
        run: pnpm -r test
```

### `.github/workflows/release-mcpb.yml`
```yaml
name: Release .mcpb
on:
  workflow_dispatch:
    inputs:
      ref:
        description: "Ref to build/release from"
        required: true
        default: "main"
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ inputs.ref }}
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - name: Install (frozen lockfile)
        run: pnpm install --frozen-lockfile
      - name: Build workspace + pack .mcpb
        run: |
          pnpm -r build
          cd packages/bundle
          node scripts/build-mcpb.mjs
          pnpm dlx @anthropic-ai/mcpb pack .mcpb-build open-state-camping.mcpb
      - name: Read bundle version
        id: v
        run: echo "version=$(node -p "require('./packages/bundle/package.json').version")" >> "$GITHUB_OUTPUT"
      - name: Create release with the .mcpb asset
        env:
          GH_TOKEN: ${{ github.token }}
          VERSION: ${{ steps.v.outputs.version }}
        run: |
          tag="camping-v$VERSION"
          if gh release view "$tag" >/dev/null 2>&1; then
            gh release upload "$tag" packages/bundle/open-state-camping.mcpb --clobber
          else
            gh release create "$tag" packages/bundle/open-state-camping.mcpb \
              --target "$(git rev-parse HEAD)" \
              --title "Camping $tag" \
              --notes "The Open State: Camping — installable .mcpb (v$VERSION). Download and add it in Claude Desktop -> Settings -> Extensions. Independent, not operated by or endorsed by Parks Canada; it never books or pays on its own."
          fi
```

### `.mcp.json` (Claude Code registration for this repo)
```json
{
  "mcpServers": {
    "open-state-camping": {
      "command": "node",
      "args": ["packages/bundle/dist/server.js"]
    }
  }
}
```

### `AGENTS.md` (conformance stanza — pins the protocol)
```markdown
# AGENTS.md

This repository is **Open State: Camping** — a local MCP that helps a citizen find
and book Parks Canada campsites accessibly. It is an implementation of the **Civic
Access Protocol** and conforms to **The Open State Constitution**
(https://github.com/JCrossman/the-open-state/blob/main/CONSTITUTION.md, tag
`constitution-v1.1`), using `@open-state/kit@^0.2.0`. These rules are binding — if
a change conflicts with one, say so and stop, and cite the article.

- **The human decides (Art. 2).** prepare_booking only *prepares* to the payment
  screen; the citizen reviews and pays. Never auto-book, never pay. Use the kit's
  `confirmGated` gate.
- **No stored government credentials (Art. 1).** The citizen signs in themselves;
  the session lives only in the kit vault, on-device. Never expose it to the model.
- **Accessibility is the purpose (Art. 3).** Accessibility attributes first-class
  and filterable; screen-reader-clean, plain-language output; carried through to
  the action.
- **Honesty (Art. 7).** Distinguish verified from assumed; fail visibly; polite
  request rates; the browser-like User-Agent is a documented, honest tension.
- **Assistive technology, not a bot (Art. 10).** Acts only in the citizen's own
  session, at their direction; never defeats human gates.

See CONFORMANCE at https://github.com/JCrossman/the-open-state/blob/main/CONFORMANCE.md.
No citizen should be excluded from what is already theirs.
```

### Optional but recommended (bring from the-open-state, generic)
- `scripts/check-pii.mjs` (+ a `"check:pii"` root script + a CI "PII tripwire"
  step) — copy from the-open-state root.
- `.github/dependabot.yml` — npm + github-actions weekly, grouped.
- `SECURITY.md` — private vulnerability reporting.

### README fixes (IMPORTANT — the current README links break when standalone)
`open-state-camping/README.md` currently links to monorepo siblings that no longer
exist here. Repoint them to the the-open-state GitHub URLs / npm (README line
numbers are for the current file):
- L17 `../CONSTITUTION.md` → https://github.com/JCrossman/the-open-state/blob/main/CONSTITUTION.md
- L17 `../AGENTS.md` → https://github.com/JCrossman/the-open-state/blob/main/AGENTS.md
- L18 `../docs/00-overview.md` → https://github.com/JCrossman/the-open-state/blob/main/docs/00-overview.md
- L19 `../docs/01-architecture.md` → https://github.com/JCrossman/the-open-state/blob/main/docs/01-architecture.md
  (the subtree split carries only `open-state-camping/docs/parks-canada-api-findings.md`;
  the `00-overview` / `01-architecture` docs live at the-open-state repo root and do
  **not** come along, so these two links break unless repointed.)
- L61 `../kit` → https://www.npmjs.com/package/@open-state/kit
- L98 `../.mcp.json` reference → `.mcp.json` (now local)
- "Build" section: drop the `open-state-camping/` path prefixes (repo root IS the
  workspace now, so `pnpm install` / `pnpm -r build` from root), and fix the stale
  `# from open-state-camping/` comment (L88) to read `# from the repo root`.
- L80 Install/Releases link is **hardcoded** to
  `https://github.com/JCrossman/the-open-state/releases?q=camping` — repoint it to
  this repo's own Releases (`https://github.com/JCrossman/can-fed-camp-mcp/releases`),
  where Phase 4 publishes `camping-v0.17.0`. (Not a "keep it": the org/repo changes.)

---

## Phase 4 — Cut the first release from the new repo
Once Phases 1–3 are merged to the new repo's `main`:
- Dispatch **`release-mcpb`** (ref `main`) → publishes `camping-v0.17.0` with the
  `.mcpb` asset **on the new repo**.

## Phase 5 — Slim `the-open-state` (separate PR, AFTER the new repo is live)
Only after Camp exists + released in its own repo:
- `git rm -r open-state-camping/`
- Remove `.github/workflows/release-mcpb.yml` (camp-specific; kit's `publish-kit`
  and `tag-release` stay).
- `pnpm-workspace.yaml` → drop the `open-state-camping/packages/*` entry (leave
  `kit`); regenerate the lockfile (`pnpm install`).
- Root `README.md` → change the Camp row to a link out to `can-fed-camp-mcp`.
- `.mcp.json` → remove the camp server entry (that path is gone).
- `CONFORMANCE.md` / docs → point "reference implementation" at the new repo.
- Verify `pnpm -r build && pnpm -r test` (now just the kit) stays green.
- The historical `camping-v0.17.0` release already on the-open-state can stay as a
  record, or be superseded by the new repo's release — your call.

## Phase 6 — Harden the new repo (your side; same as the-open-state)
- Add MIT `LICENSE`, `CODEOWNERS` (`* @JCrossman`).
- Branch ruleset on `main`: require PR + `build-test` status check + block
  force-push/deletion; squash-only.
- Enable secret scanning + push protection, CodeQL default setup, Dependabot
  security updates, private vulnerability reporting.
- Make the repo public when ready.

---

### Naming note
The workspace/package internal names still say `@open-state/core`,
`@open-state/bundle`, and the `.mcpb` is `open-state-camping`. That's fine — none
are published to npm (both are `private`/unpublished). Rename later if you want the
repo's `can-fed-camp` identity reflected internally; not required for function.
