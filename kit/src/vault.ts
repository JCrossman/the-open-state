/**
 * Encrypted, on-device session vault — Constitution Article 1.
 *
 * After the citizen logs in (in their own browser), the implementation captures
 * the resulting session cookies and keeps them here: AES-256-GCM encrypted, on
 * the citizen's own machine, never transmitted to any server the implementer
 * runs, and never shown to the model (Arts. 1.3–1.5). The key lives beside the
 * vault in a 0600 file (or in the env var the implementation names), so the
 * vault is useless if copied off the device without it.
 *
 * Promoted from the Camping implementation's vault, byte-compatible with it:
 * same blob format (v1), same key handling, same failure semantics (any
 * corruption or tampering reads as "no session" — GCM authentication fails
 * closed, Art. 7.2).
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

export interface VaultOptions {
  /**
   * Directory holding the vault (created 0700 if absent). Implementations
   * usually compute this from their own env var with a service-specific
   * default, e.g. `process.env.OPEN_STATE_HOME ?? ~/.open-state-camping`.
   */
  dir: string;
  /**
   * Env var that may hold the base64 vault key (32 bytes). When unset or
   * invalid, a key file beside the vault is used (created 0600 on first use).
   */
  keyEnvVar?: string;
}

/** A service-agnostic default vault directory: `~/.open-state/<service>`. */
export function defaultVaultDir(service: string): string {
  return join(homedir(), ".open-state", service);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function loadOrCreateKey(opts: VaultOptions): Buffer {
  const envKey = opts.keyEnvVar ? process.env[opts.keyEnvVar] : undefined;
  if (envKey) {
    const b = Buffer.from(envKey, "base64");
    if (b.length === KEY_BYTES) return b;
  }
  ensureDir(opts.dir);
  const keyPath = join(opts.dir, KEY_FILE);
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
export function saveSession(session: Session, opts: VaultOptions): void {
  ensureDir(opts.dir);
  const key = loadOrCreateKey(opts);
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
  const path = join(opts.dir, SESSION_FILE);
  writeFileSync(path, JSON.stringify(blob), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
}

/** Load and decrypt the stored session, or null if absent/unreadable/tampered. */
export function loadSession(opts: VaultOptions): Session | null {
  const path = join(opts.dir, SESSION_FILE);
  if (!existsSync(path)) return null;
  try {
    const blob = JSON.parse(readFileSync(path, "utf8")) as {
      iv: string;
      tag: string;
      data: string;
    };
    const key = loadOrCreateKey(opts);
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
export function clearSession(opts: VaultOptions): boolean {
  const path = join(opts.dir, SESSION_FILE);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** Render the session's cookies as a `Cookie:` header value for API calls. */
export function cookieHeader(session: Session): string {
  return session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * A named cookie's value (commonly the `XSRF-TOKEN` double-submit token that
 * Angular-style services expect echoed in an `X-XSRF-TOKEN` header).
 */
export function cookieValue(session: Session, name: string): string | undefined {
  return session.cookies.find((c) => c.name === name)?.value;
}

/** Constant-time check that two keys match (used by tests/diagnostics). */
export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
