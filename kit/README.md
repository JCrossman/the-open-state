# @open-state/kit

The **code embodiment of [The Open State Constitution](../CONSTITUTION.md)** —
the shared, constitution-compliant plumbing every Civic Access Protocol
implementation uses, so conformance is inherited from working code rather than
re-derived (and re-bugged) per project.

Every Open State implementation shares one lifecycle:

> connect the citizen's account via **on-device session capture** → read/search
> → **prepare** a consequential action → **the human confirms** → execute up to
> the citizen's own final step (payment, submission) — never past it.

The kit is that lifecycle's constitutional core. Domain logic — the service's
API, its bookings/trips/appointments — stays in each implementation.

## Modules

| Module | Constitution | What it gives you |
|---|---|---|
| `vault` | Art. 1 (citizen sovereignty over credentials) | AES-256-GCM encrypted on-device session store. Key in a 0600 file beside the vault or a named env var. Tampering/corruption fails closed (reads as "no session"). No identity, no passwords — only cookies. |
| `confirm-gate` | Art. 2 (the human decides) | The standard two-phase tool shape: `prepare()` fully describes in plain language and holds **nothing**; only an explicit `confirm: true` reaches `execute()`, which stops at the citizen's own final step. Standardized preview wording. |
| `capture` | Arts. 1, 10 (assistive technology, not a bot) | Opens the **citizen's own Chrome** at the service's sign-in page; the citizen logs in themselves (and passes any human gate themselves, Art. 10.2). The implementation supplies only the service-specific "signed in" signal; the cookies go straight to the vault. |

## Use

Install from npm (public, no auth):

```bash
npm install @open-state/kit       # or: pnpm add @open-state/kit
```

```ts
import {
  saveSession, loadSession, clearSession, cookieHeader, cookieValue,
  captureSession, confirmGated, previewFooter, text,
} from "@open-state/kit";

const VAULT = { dir: process.env.MY_HOME ?? defaultVaultDir("my-service"),
                keyEnvVar: "MY_SESSION_KEY" };

// connect_account: the citizen signs in themselves; we keep only the session.
const session = await captureSession({
  loginUrl: "https://service.example.gc.ca/login",
  cookieOrigin: "https://service.example.gc.ca",
  provider: "my_service",
  profileDir: join(VAULT.dir, "browser-profile"),
  isSignedIn: async (page) => page.evaluate(/* poll the app's own userInfo */),
});
saveSession(session, VAULT);

// A consequential action: one tool, two phases (Art. 2).
const handler = confirmGated({
  async prepare(args) {
    // validate + assemble; hold/write/charge NOTHING
    return { summary: "Here's the booking I'll prepare: …",
             onConfirm: "confirm and I'll hold it and open your cart to pay yourself" };
  },
  async execute(args, prepared) {
    // perform up to — never past — the citizen's own final step
    return "Your cart is ready — review and pay yourself.";
  },
});
```

`puppeteer-core` is an **optional peer dependency**, loaded lazily — consumers
that never capture a session never load it.

## What does NOT belong here

Service clients, booking/trip/appointment models, provider constants, search
logic. If you're unsure whether something is kit or domain, it's domain —
promoting code later is cheap; pulling it back out from under three consumers
is not. Promote only what is *actually duplicated* across ≥2 implementations.

## Versioning

Strict semver, and consumers **pin** it. The kit's public API is a conformance
surface: a breaking change here is a governance act (like amending the
Constitution), released deliberately, never casually. It is published to **npm
as `@open-state/kit`** (the camping packages in this repo consume it via the
pnpm workspace; external implementations install the npm release). Each release
is cut by pushing a `kit-v*` tag, which the `publish-kit` workflow publishes.

## Tests

```bash
pnpm --filter @open-state/kit test
```

Offline and deterministic. The vault tests prove encryption-at-rest, fail-closed
tampering, and key isolation; the gate tests prove nothing executes without
explicit confirmation. Browser capture is exercised by the consuming
implementations (it requires a real, citizen-driven Chrome — honestly outside
what an offline test can claim, Art. 7.1).
