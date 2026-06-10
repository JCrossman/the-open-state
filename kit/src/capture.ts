/**
 * Citizen-driven browser session capture — Constitution Articles 1 and 10.
 *
 * The implementation does NOT automate the login. It opens the citizen's own
 * installed Chrome at the service's sign-in page; the citizen logs in exactly
 * as they normally would (any IdP, any human-verification challenge — they
 * pass it themselves, Art. 10.2). Once the service-specific `isSignedIn`
 * signal fires, the resulting cookies are read and handed to the local
 * encrypted vault. The session never leaves the device and is never shown to
 * the model (Arts. 1.4, 1.5).
 *
 * puppeteer-core is an optional peer dependency, imported lazily — search-only
 * consumers never load it.
 */
import type { Browser, Page } from "puppeteer-core";
import type { Session, StoredCookie } from "./vault.js";

export interface LaunchOptions {
  /** Persistent browser profile dir (keeps the citizen signed in next time). */
  profileDir: string;
}

export interface CaptureOptions extends LaunchOptions {
  /** The service's own sign-in page, opened for the citizen. */
  loginUrl: string;
  /** Origin whose cookies form the session (e.g. "https://reservation.pc.gc.ca"). */
  cookieOrigin: string;
  /** Recorded on the Session (e.g. "parks_canada", "alberta_health"). */
  provider: string;
  /**
   * Service-specific signal that the citizen has finished signing in —
   * typically polling the app's own userInfo endpoint from page context.
   * Must return false (not throw) while logged out.
   */
  isSignedIn: (page: Page) => Promise<boolean>;
  /** How long to wait for the citizen to finish signing in (default 5 min). */
  timeoutMs?: number;
  /** How often to re-check the signal (default 2.5 s). */
  pollMs?: number;
  /** Human name of the service for error messages (default: the provider). */
  serviceName?: string;
}

/**
 * Launch the citizen's own visible Chrome with a persistent profile. The
 * automation banner/fingerprint is reduced so federated logins behave like a
 * normal browser — this is the citizen's own use of their own browser, not
 * automation against the service (Art. 10.3); any human gate is passed by the
 * human (Art. 10.2).
 */
export async function launchCitizenBrowser(opts: LaunchOptions): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  return puppeteer.launch({
    channel: "chrome", // the citizen's installed Google Chrome
    headless: false, // visible: the citizen drives
    defaultViewport: null,
    userDataDir: opts.profileDir,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--start-maximized",
    ],
  });
}

/**
 * Open Chrome, let the citizen sign in, and return their captured session.
 * Throws a plain-language error if Chrome can't be opened or the login times
 * out (Art. 7.2: fail visibly, in words the citizen can act on).
 */
export async function captureSession(opts: CaptureOptions): Promise<Session> {
  const service = opts.serviceName ?? opts.provider;
  let browser: Browser;
  try {
    browser = await launchCitizenBrowser(opts);
  } catch (err) {
    throw new Error(
      `I couldn't open Google Chrome to sign you in. The Open State opens your ` +
        `own Chrome so you log in to ${service} yourself; please make sure ` +
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
    await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded" });

    await waitForSignIn(page, opts);

    const raw = await page.cookies(opts.cookieOrigin);
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
      provider: opts.provider,
      cookies,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function waitForSignIn(page: Page, opts: CaptureOptions): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const poll = opts.pollMs ?? 2_500;
  while (Date.now() < deadline) {
    const signedIn = await opts.isSignedIn(page).catch(() => false);
    if (signedIn) return;
    await new Promise((res) => setTimeout(res, poll));
  }
  throw new Error(
    "I waited but didn't see a completed sign-in. When you're ready, run " +
      "connect_account again and finish signing in.",
  );
}
