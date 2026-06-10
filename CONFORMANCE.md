# Civic Access Protocol — Conformance

How a project declares, inherits, and checks conformance with
[`CONSTITUTION.md`](CONSTITUTION.md). The Constitution defines the obligations;
this document is the practical path to meeting them.

## 1. Declare what you conform to

Conformance is to a **version**, not to a moving document. In your project's
README:

> This project implements the **Civic Access Protocol** and conforms to
> [The Open State Constitution](https://github.com/JCrossman/the-open-state/blob/main/CONSTITUTION.md)
> at tag `constitution-vX.Y`, using `@open-state/kit@X.Y.Z`.

Pin both. When the Constitution or kit moves, *upgrading is a deliberate act*
reviewed against your implementation — never silent inheritance.

## 2. Inherit the load-bearing parts from the kit

[`@open-state/kit`](kit/README.md) is the code embodiment of the Constitution's
hardest requirements. Using it is how a project is compliant **by
construction** rather than by re-implementation:

| Requirement | Kit module |
|---|---|
| Credentials/session never leave the device, encrypted at rest (Arts. 1.3–1.5) | `vault` |
| Consequential actions prepare-then-confirm; never auto-complete (Arts. 2.1–2.3) | `confirm-gate` |
| The citizen signs in themselves; human gates passed by the human (Arts. 10.1–10.3) | `capture` |

Hand-rolling these is permitted by the Constitution but discouraged: a fork of
the requirements is a fork of the bugs.

## 3. Put the rules in the agent's context

Most constitutional rules are **judgment, not lint** — for agent-built
projects, the strongest practical enforcement is the rules being in the coding
agent's context every session. Add this stanza to your project's `AGENTS.md`
(or `CLAUDE.md`), filled in:

```markdown
## The Open State — binding constitution

This project conforms to The Open State Constitution
(https://github.com/JCrossman/the-open-state/blob/main/CONSTITUTION.md,
tag `constitution-vX.Y`) and uses `@open-state/kit@X.Y.Z`. The non-negotiables:

- **The human decides (Art. 2).** Tools may fully *prepare* a consequential
  action (booking, payment, submission, cancellation) but MUST stop at the
  citizen's own final step. Use the kit's `confirmGated` two-phase shape.
  Never design to win a contested public resource by automation.
- **No stored government credentials (Art. 1).** No passwords or secrets in
  code, logs, tool output, or any server. Citizen sessions live only in the
  kit vault, on-device, encrypted. Never expose a session to the model.
- **Accessibility is the purpose (Art. 3).** Screen-reader-clean output,
  plain language, accessibility attributes first-class and filterable, and
  accessible *through to the point of action* — never hand the citizen back
  to an inaccessible interface to finish.
- **Honesty (Art. 7).** Distinguish verified from assumed. Fail visibly in
  plain language. Polite request rates; no degradation of the service.
- **Assistive technology, not a bot (Art. 10).** Act only in the citizen's
  own session, on their device, at their direction. Never defeat human
  gates (queues, CAPTCHAs) — the citizen passes them personally.
- **Data minimization (Arts. 5, 6).** Collect the minimum; citizen data is
  viewable, exportable, deletable; never monetized. No PII in the repo —
  test fixtures use synthetic people.

If a requested change conflicts with these, say so and stop rather than
complying. Cite the article.
```

## 4. The checkable subset (CI)

Honestly: only a sliver of the Constitution is mechanically checkable
(Art. 7.1 — don't claim more than that). What CI *can* gate:

- **No secrets/PII committed** — secret scanning on (GitHub's push protection),
  fixtures synthetic.
- **Tests run offline** — no live calls to the public service from CI
  (Art. 7.3); fixtures only.
- **A payment/submission path is absent** — no code path that enters payment
  credentials or finalizes on the citizen's behalf (in camping, the booking
  stops at the cart; verify yours stops at the citizen's final step).

Everything else — plain language, accessibility, honest failure — is reviewed
by humans (and agents carrying §3) on every PR.

## 5. Current conformance: this repo

`open-state-camping` is the reference implementation. Its conformance posture,
including its honestly-recorded tensions (e.g. the browser-like User-Agent
needed to function at all vs. Art. 7.3 "honest identification"), is documented
in [`open-state-camping/README.md`](open-state-camping/README.md) under
"Honest notes and known limits". A conformance claim with no known-limits
section is a red flag, not a clean bill.
