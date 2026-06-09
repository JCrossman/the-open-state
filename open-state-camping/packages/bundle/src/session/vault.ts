/**
 * Encrypted, on-device session vault.
 *
 * After the citizen logs in (in their own browser), we capture the resulting
 * session cookies and keep them here — AES-256-GCM encrypted, on the citizen's
 * own machine, never transmitted to any server we run and never shown to the
 * model (Constitution Articles 1.4, 1.5). The key lives beside the vault in a
 * 0600 file (or `OPEN_STATE_SESSION_KEY`), so the vault is useless if copied
 * off the device without it.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SESSION_FILE = "session.enc";
const KEY_FILE = "key";

/** One cookie captured from the citizen's logged-in browser. */
export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

/** A captured, citizen-owned session. No identity, no credentials — only cookies. */
export interface Session {
  provider: string;
  cookies: StoredCookie[];
  capturedAt: string;
}

/** Default vault directory on the citizen's device. */
export function defaultVaultDir(): string {
  return process.env["OPEN_STATE_HOME"] ?? join(homedir(), ".open-state-camping");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function loadOrCreateKey(dir: string): Buffer {
  const envKey = process.env["OPEN_STATE_SESSION_KEY"];
  if (envKey) {
    const b = Buffer.from(envKey, "base64");
    if (b.length === KEY_BYTES) return b;
  }
  ensureDir(dir);
  const keyPath = join(dir, KEY_FILE);
  if (existsSync(keyPath)) {
    const b = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (b.length === KEY_BYTES) return b;
  }
  const key = randomBytes(KEY_BYTES);
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* best-effort on platforms without POSIX perms */
  }
  return key;
}

/** Encrypt and persist a session to the vault (0600). */
export function saveSession(session: Session, dir = defaultVaultDir()): void {
  ensureDir(dir);
  const key = loadOrCreateKey(dir);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const blob = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
  const path = join(dir, SESSION_FILE);
  writeFileSync(path, JSON.stringify(blob), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
}

/** Load and decrypt the stored session, or null if absent/unreadable/tampered. */
export function loadSession(dir = defaultVaultDir()): Session | null {
  const path = join(dir, SESSION_FILE);
  if (!existsSync(path)) return null;
  try {
    const blob = JSON.parse(readFileSync(path, "utf8")) as {
      iv: string;
      tag: string;
      data: string;
    };
    const key = loadOrCreateKey(dir);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(blob.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as Session;
  } catch {
    // Wrong key, corruption, or tampering (GCM auth fails) — treat as no session.
    return null;
  }
}

/** Remove the stored session (the citizen disconnecting their account). */
export function clearSession(dir = defaultVaultDir()): boolean {
  const path = join(dir, SESSION_FILE);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** Render the session's cookies as a `Cookie:` header value for API calls. */
export function cookieHeader(session: Session): string {
  return session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** The Angular CSRF token (the `XSRF-TOKEN` cookie value), if present. */
export function xsrfToken(session: Session): string | undefined {
  return session.cookies.find((c) => c.name === "XSRF-TOKEN")?.value;
}

/**
 * Auth headers to replay the citizen's session on Parks Canada API calls:
 * the `Cookie` header plus the `X-XSRF-TOKEN` echo Angular expects on
 * state-changing requests (docs/captures: cookie session + XSRF double-submit).
 */
export function sessionAuthHeaders(session: Session): Record<string, string> {
  const headers: Record<string, string> = { Cookie: cookieHeader(session) };
  const xsrf = xsrfToken(session);
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
  return headers;
}

/** Constant-time check that two keys match (used by tests/diagnostics). */
export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
