/**
 * Session capture: the citizen signs in to Parks Canada themselves, in a real
 * Chrome window, and we read the resulting session cookies.
 *
 * We do NOT automate the login — Puppeteer only *opens* the citizen's own Chrome
 * (system install) and they log in exactly as they normally would (Google,
 * GCKey, or Facebook). When they're signed in, we read the reservation.pc.gc.ca
 * cookies (including the httpOnly session cookie and the XSRF-TOKEN) and hand
 * them to the local encrypted vault. The session never leaves the device and is
 * never shown to the model (Constitution Articles 1.4, 1.5, 10).
 */
import type { Browser, Page } from "puppeteer-core";
import { join } from "node:path";
import { defaultVaultDir, type Session, type StoredCookie } from "./vault.js";

export interface CaptureOptions {
  loginUrl?: string;
  /** Where the persistent browser profile lives (keeps you signed in next time). */
  profileDir?: string;
  /** How long to wait for the citizen to finish signing in. */
  timeoutMs?: number;
}

/**
 * Open Chrome, let the citizen sign in, and return their captured session.
 * Throws a plain-language error if Chrome can't be opened or the login times out.
 */
export async function captureSession(opts: CaptureOptions = {}): Promise<Session> {
  const loginUrl = opts.loginUrl ?? "https://reservation.pc.gc.ca/login";
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const profileDir = opts.profileDir ?? join(defaultVaultDir(), "browser-profile");

  const puppeteer = (await import("puppeteer-core")).default;

  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      channel: "chrome", // use the citizen's installed Google Chrome
      headless: false, // visible: the citizen drives the login
      defaultViewport: null,
      userDataDir: profileDir, // persist so they don't re-login every time
      // Reduce the automation fingerprint so federated logins behave like a
      // normal browser. We are not defeating a human gate — the human logs in
      // and passes any challenge themselves (Constitution Art. 10.2).
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--start-maximized",
      ],
    });
  } catch (err) {
    throw new Error(
      "I couldn't open Google Chrome to sign you in. The Open State opens your " +
        "own Chrome so you log in to Parks Canada yourself; please make sure " +
        "Google Chrome is installed, then try again. (" +
        (err instanceof Error ? err.message : String(err)) +
        ")",
    );
  }

  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.evaluateOnNewDocument(() => {
      // Some federated IdPs distrust a webdriver flag even when a human types.
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    await waitForSignIn(page, timeoutMs);

    const raw = await page.cookies("https://reservation.pc.gc.ca");
    const cookies: StoredCookie[] = raw.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    }));
    if (cookies.length === 0) {
      throw new Error("I couldn't find a session after sign-in. Please try again.");
    }
    return {
      provider: "parks_canada",
      cookies,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Open the citizen's Chrome at their cart so they review the prepared booking and
 * pay themselves. We assemble everything up to payment via the API; entering a
 * card is the one step we never take for them (Constitution Art. 2). Uses the same
 * persistent profile as sign-in, so the cart we built under their session is
 * already there. The window is left open for them; we don't await its close.
 */
export async function openCheckout(
  opts: CaptureOptions & { cartUrl?: string } = {},
): Promise<void> {
  const cartUrl = opts.cartUrl ?? "https://reservation.pc.gc.ca/cart";
  const profileDir = opts.profileDir ?? join(defaultVaultDir(), "browser-profile");
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: false,
    defaultViewport: null,
    userDataDir: profileDir,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--start-maximized"],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.goto(cartUrl, { waitUntil: "domcontentloaded" });
  // Intentionally leave the browser open so the citizen can complete payment.
}

/**
 * Poll the app's own `userInfo` endpoint until it reports an authenticated
 * citizen. Logged-out responses are 401/empty; once signed in it returns the
 * account, which is our signal that the session cookies are good to capture.
 * (Detection heuristic — refine against the first real sign-in.)
 */
async function waitForSignIn(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const signedIn = await page
      .evaluate(async () => {
        try {
          const r = await fetch("/api/account/userInfo", {
            headers: { Accept: "application/json" },
          });
          if (!r.ok) return false;
          const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
          if (!j || typeof j !== "object") return false;
          return Boolean(
            j["email"] ||
              j["userId"] ||
              j["id"] ||
              j["shopperUid"] ||
              j["firstName"] ||
              j["isAuthenticated"],
          );
        } catch {
          return false;
        }
      })
      .catch(() => false);
    if (signedIn) return;
    await new Promise((res) => setTimeout(res, 2500));
  }
  throw new Error(
    "I waited but didn't see a completed sign-in. When you're ready, run " +
      "connect_account again and finish signing in.",
  );
}
