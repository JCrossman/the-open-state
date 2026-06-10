# Contributing to The Open State

Thanks for your interest. **The Open State** is a public-interest reference
implementation of the **Civic Access Protocol**: it lets a citizen reach public
services through their own AI assistant, in plain language, while keeping their
credentials and their control. Contributions are welcome — please read this
guide first.

## Read these first (they're binding)

- [`CONSTITUTION.md`](CONSTITUTION.md) — the non-negotiable rules. Every change
  must comply. The ones contributors hit most often:
  - **The human decides and pays.** Tools may *prepare* an action up to the
    payment/confirmation screen, but never pay, book, or submit on the citizen's
    behalf without explicit confirmation (Art. 2). No sniping, no automation that
    removes the human's final say.
  - **No stored government credentials.** The citizen authenticates in their own
    session; secrets never reach the model or any server we run (Art. 1).
  - **Accessibility is the point**, not a feature flag (Art. 3). Output must read
    cleanly with a screen reader.
  - **Be honest** about limits — record reality, don't guess (Art. 7).
  - **Data minimization.** Never commit credentials, personal data, or real
    booking PII. Test fixtures use synthetic data.
- [`AGENTS.md`](AGENTS.md) — working agreement, including "verify against current
  docs at build time, do not assume."
- [`README.md`](README.md) and [`docs/`](docs) — architecture and the verified
  Parks Canada API contract.

## Project layout

A pnpm + TypeScript workspace rooted at the repository root:

- [`kit/`](kit) — **@open-state/kit**, the Constitution's code embodiment
  (session vault, confirm gate, citizen-driven sign-in). Shared by every
  implementation; see [`CONFORMANCE.md`](CONFORMANCE.md). Its public API is a
  conformance surface — breaking changes are deliberate, versioned acts.
- [`open-state-camping/`](open-state-camping) — the reference implementation:
  - `packages/core` — the provider, booking-cart assembly, availability, policies.
  - `packages/bundle` — the local MCP server (stdio) and the `.mcpb` packaging.

## Development setup

Requires **Node >= 20** and **pnpm 10.33.0** (via `corepack enable`, or install
pnpm directly — the version is pinned in the root `package.json`).

```bash
pnpm install    # at the repository root
pnpm -r build   # tsc — also typechecks
pnpm -r test    # vitest, fully offline against recorded fixtures
```

Tests **never** call the live Parks Canada API — they run against recorded
fixtures, and booking carts are diffed key-for-key against real captured
sessions. Keep it that way: don't add tests that hit the network.

## Pull requests

1. Branch off `main`.
2. Make your change with a clear, focused commit history. Match the surrounding
   code's style, naming, and comment density.
3. Make sure `pnpm -r build` and `pnpm -r test` pass locally.
4. Open a PR against `main`. CI (the **`build-test`** check) must be green before
   merge — it runs the same build + test on every PR.
5. PRs are **squash-merged** to keep `main` history linear. Write a PR title that
   works as the squash commit subject.

### Versioning

The server version is single-sourced. When you cut a release, bump **all three**
together — `packages/bundle/src/version.ts`, `packages/bundle/package.json`, and
`packages/bundle/manifest.json` — to the same value. A test
(`version.test.ts`) and the `.mcpb` build script both fail loudly on drift.

## Reporting bugs and security issues

- **Bugs / features:** open a GitHub issue with steps to reproduce. For an
  upstream API mismatch, a sanitized HAR (with personal details removed) is
  hugely helpful.
- **Security / privacy vulnerabilities:** please do **not** open a public issue.
  Use GitHub's **private security advisory** ("Report a vulnerability" under the
  repository's Security tab) so it can be addressed before disclosure. Anything
  touching credentials, stored sessions, or the SSRF/notify path is in scope.

## Code of conduct

Be respectful and constructive. The mission is to make public services reachable
by everyone — *no citizen should be excluded from what is already theirs.*
