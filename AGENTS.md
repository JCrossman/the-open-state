# AGENTS.md

Entry point for agentic coding tools (Claude Code, GitHub Copilot). Read this first, then the docs it points to.

> Claude Code also reads this as `CLAUDE.md`; GitHub Copilot reads `.github/copilot-instructions.md`. Keep one canonical copy here and have those two files contain a single line pointing to this file, or symlink them.

## What you are building

A reference implementation of the **Civic Access Protocol**, under the movement **The Open State**. The goal is to let citizens reach public services through their own AI assistant, in plain language, while keeping their credentials and their control. The first service is Canadian campsite booking (Parks Canada first, Alberta Parks later).

## Read these, in order

1. **CONSTITUTION.md** (repo root). Binding commitments. Never violate these, even for convenience. The most important: never store citizen government credentials; never auto-complete a consequential action; accessibility and plain language are mandatory.
1. **CONFORMANCE.md** (repo root). How implementations declare and inherit conformance, and the `AGENTS.md` stanza other Open State projects paste in.
1. **docs/00-overview.md**. The full arc, principles, and glossary.
1. **docs/01-architecture.md**. Cross-cutting technical decisions that apply to every milestone (stack, provider abstraction, auth model, data model, security).
1. **docs/milestones/**. Build one milestone at a time. Start with `m1-parks-canada-local.md`. Do not pull work forward from later milestones unless asked.

## The kit

Constitutional plumbing shared by every implementation lives in **`kit/`
(@open-state/kit)**: the encrypted on-device session vault (Art. 1), the
two-phase confirm gate (Art. 2), and citizen-driven browser sign-in (Art. 10).
Use it rather than re-implementing those behaviors; treat its public API as a
conformance surface (breaking changes are deliberate, semver-major acts).
Promote code into the kit only when it is genuinely constitutional and
duplicated across ≥2 implementations — when in doubt, it's domain code and
stays in the implementation.

## How to work

- Build milestone by milestone. M1 is fully specified and locked. M2 onward have validation gates: where a milestone says “validate before building,” stop and confirm the real-world behavior (live API shape, network traffic) before writing code against assumptions.
- When the spec and reality disagree, reality wins. Flag the discrepancy, do not silently guess.
- Prefer small, typed, tested functions. Keep the provider interface clean so new services slot in without changing tool code.
- Every tool output is read by a citizen who may use a screen reader or have limited English. Write accordingly.

## Hard guardrails (from the Constitution)

- Do not write code that stores, logs, or transmits a citizen’s government credentials.
- Do not write code that logs in to a government service as the citizen on the server.
- Do not write code that completes a booking, payment, or submission. Prepare only; the human confirms.
- Do not pass an inbound auth token through to an upstream service.
- Do not add data collection beyond what the task needs.
