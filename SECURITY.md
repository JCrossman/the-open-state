# Security Policy

The Open State exists to handle the most sensitive thing a citizen has — their
access to a public service — safely. We take security reports seriously, and we'd
rather hear about a problem privately than read about it in a public issue.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** Disclosing it
publicly before it's fixed puts citizens at risk.

Instead, use **GitHub's private vulnerability reporting**:

1. Go to the **[Security tab](https://github.com/JCrossman/the-open-state/security)**
   of this repository.
2. Click **"Report a vulnerability."**
3. Describe the issue, with steps to reproduce and the impact you see.

This opens a private advisory visible only to the maintainers and you. We'll
acknowledge it as soon as we can (this is a small, public-interest project — please
allow a few days), work with you on a fix, and credit you in the advisory when it's
published, unless you'd prefer to stay anonymous.

## What's in scope

Anything that could let someone reach a citizen's session, credentials, or data, or
act on their behalf without consent — for example:

- **The session vault** (`@open-state/kit` `vault`): weaknesses in encryption at
  rest, key handling, or file permissions that could expose a stored session.
- **Session capture / browser sign-in** (`kit` `capture`): anything that could
  leak the captured session off the device, or to the model/client.
- **The confirm gate** (`kit` `confirm-gate`): any path that lets a consequential
  action (a booking, payment, submission, cancellation) execute **without** the
  citizen's explicit confirmation — this is a Constitution Article 2 violation and
  is treated as a serious bug.
- **The notification path** (alerts `notify_target`): SSRF, open-relay, or
  request-forgery via a citizen-supplied or auto-provisioned notify URL.
- **Credential or PII exposure**: any case where a credential, session, or personal
  data reaches a log, tool output, the model, an error message, a commit, or a test
  fixture.

These map directly to the binding [`CONSTITUTION.md`](CONSTITUTION.md) (Articles 1,
2, 5, 9, 10). A report that demonstrates a constitutional violation is, by
definition, in scope.

## What's not a vulnerability

- The browser-like User-Agent the camping implementation sends (a documented,
  honestly-recorded tension — see `open-state-camping/README.md` "Honest notes").
- Reports requiring physical access to an already-unlocked device, or the citizen's
  own deliberate misuse of their own session.
- Findings against a third-party service (e.g. Parks Canada) rather than this code —
  report those to the service operator.

## Supported versions

This project is pre-1.0 and moves fast. Security fixes land on `main`; we don't
backport to older tags. Pin a tag for reproducibility, but track `main` for fixes.

*No citizen should be excluded from what is already theirs — and no citizen should
be put at risk reaching it.*
