/**
 * Camping's session vault: the kit's encrypted on-device vault (Constitution
 * Art. 1; see @open-state/kit) configured for this service — Parks Canada
 * sessions under OPEN_STATE_HOME (default ~/.open-state-camping), key
 * overridable via OPEN_STATE_SESSION_KEY. Public API unchanged from when this
 * logic lived here; the implementation is now shared by every Open State MCP.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import * as kit from "@open-state/kit";

export type { Session, StoredCookie } from "@open-state/kit";
export { cookieHeader, keysEqual } from "@open-state/kit";
import type { Session } from "@open-state/kit";

/** Default vault directory on the citizen's device. */
export function defaultVaultDir(): string {
  return process.env["OPEN_STATE_HOME"] ?? join(homedir(), ".open-state-camping");
}

const opts = (dir: string): kit.VaultOptions => ({
  dir,
  keyEnvVar: "OPEN_STATE_SESSION_KEY",
});

/** Encrypt and persist a session to the vault (0600). */
export function saveSession(session: Session, dir = defaultVaultDir()): void {
  kit.saveSession(session, opts(dir));
}

/** Load and decrypt the stored session, or null if absent/unreadable/tampered. */
export function loadSession(dir = defaultVaultDir()): Session | null {
  return kit.loadSession(opts(dir));
}

/** Remove the stored session (the citizen disconnecting their account). */
export function clearSession(dir = defaultVaultDir()): boolean {
  return kit.clearSession(opts(dir));
}

/** The Angular CSRF token (the `XSRF-TOKEN` cookie value), if present. */
export function xsrfToken(session: Session): string | undefined {
  return kit.cookieValue(session, "XSRF-TOKEN");
}

/**
 * Auth headers to replay the citizen's session on Parks Canada API calls:
 * the `Cookie` header plus the `X-XSRF-TOKEN` echo Angular expects on
 * state-changing requests (docs/captures: cookie session + XSRF double-submit).
 */
export function sessionAuthHeaders(session: Session): Record<string, string> {
  const headers: Record<string, string> = { Cookie: kit.cookieHeader(session) };
  const xsrf = xsrfToken(session);
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
  return headers;
}
