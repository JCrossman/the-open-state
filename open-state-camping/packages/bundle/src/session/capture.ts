/**
 * Camping's session capture: the kit's citizen-driven browser capture
 * (Constitution Arts. 1, 10; see @open-state/kit) configured for Parks Canada.
 * The citizen signs in themselves in their own Chrome (Google, GCKey, or
 * Facebook); this module supplies only the Parks-specific pieces — the login
 * URL, the cookie origin, and the userInfo-based "signed in" signal — plus
 * the checkout hand-off that opens the citizen's cart so they pay themselves.
 */
import type { Page } from "puppeteer-core";
import { join } from "node:path";
import { captureSession as kitCapture, launchCitizenBrowser, type Session } from "@open-state/kit";
import { defaultVaultDir } from "./vault.js";

const ORIGIN = "https://reservation.pc.gc.ca";

export interface CaptureOptions {
  loginUrl?: string;
  /** Where the persistent browser profile lives (keeps you signed in next time). */
  profileDir?: string;
  /** How long to wait for the citizen to finish signing in. */
  timeoutMs?: number;
}

/**
 * Open Chrome, let the citizen sign in to Parks Canada, and return their
 * captured session. Throws a plain-language error if Chrome can't be opened
 * or the login times out.
 */
export async function captureSession(opts: CaptureOptions = {}): Promise<Session> {
  return kitCapture({
    loginUrl: opts.loginUrl ?? `${ORIGIN}/login`,
    cookieOrigin: ORIGIN,
    provider: "parks_canada",
    serviceName: "Parks Canada",
    profileDir: opts.profileDir ?? join(defaultVaultDir(), "browser-profile"),
    timeoutMs: opts.timeoutMs ?? 5 * 60_000,
    isSignedIn: parksSignedIn,
  });
}

/**
 * Poll the app's own `userInfo` endpoint until it reports an authenticated
 * citizen. Logged-out responses are 401/empty; once signed in it returns the
 * account, which is our signal that the session cookies are good to capture.
 */
async function parksSignedIn(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
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
  });
}

/**
 * Open the citizen's Chrome at their cart so they review the prepared booking and
 * pay themselves. We assemble everything up to payment via the API; entering a
 * card is the one step we never take for them (Constitution Art. 2).
 *
 * The booking is committed under the citizen's session, but the SPA decides which
 * cart to show from `localStorage` (`cartUid` / `cartTransactionUid`) — so we seed
 * those keys with the cart we built before loading /cart, otherwise the page shows
 * a fresh empty cart. Uses the same persistent profile as sign-in (same session).
 * The window is left open for them; we don't await its close.
 */
export async function openCheckout(
  opts: CaptureOptions & {
    cartUrl?: string;
    cartUid?: string;
    cartTransactionUid?: string;
  } = {},
): Promise<void> {
  const cartUrl = opts.cartUrl ?? `${ORIGIN}/cart`;
  const profileDir = opts.profileDir ?? join(defaultVaultDir(), "browser-profile");
  const browser = await launchCitizenBrowser({ profileDir });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  if (opts.cartUid) {
    // Establish the origin so localStorage is the reservation site's, then point
    // the SPA at the cart we built (its keys are literally "cartUid"/"cartTransactionUid").
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (cartUid: string, cartTransactionUid: string) => {
        try {
          localStorage.setItem("cartUid", cartUid);
          if (cartTransactionUid) localStorage.setItem("cartTransactionUid", cartTransactionUid);
        } catch {
          /* localStorage may be unavailable; the cart link still works */
        }
      },
      opts.cartUid,
      opts.cartTransactionUid ?? "",
    );
  }
  await page.goto(cartUrl, { waitUntil: "domcontentloaded" });
  // Intentionally leave the browser open so the citizen can complete payment.
}
