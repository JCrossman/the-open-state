import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSession,
  cookieHeader,
  cookieValue,
  loadSession,
  saveSession,
  type Session,
  type VaultOptions,
} from "../src/vault.js";

const session: Session = {
  provider: "test_service",
  cookies: [
    { name: "SESSION", value: "abc123", domain: "example.gc.ca" },
    { name: "XSRF-TOKEN", value: "tok-1" },
  ],
  capturedAt: "2026-01-01T00:00:00.000Z",
};

function vault(): VaultOptions {
  return { dir: mkdtempSync(join(tmpdir(), "osk-vault-")) };
}

describe("session vault (Constitution Art. 1)", () => {
  it("round-trips a session encrypted at rest", () => {
    const v = vault();
    saveSession(session, v);
    // At rest it is ciphertext: no cookie value appears in the file.
    const raw = readFileSync(join(v.dir, "session.enc"), "utf8");
    expect(raw).not.toContain("abc123");
    expect(raw).not.toContain("tok-1");
    expect(loadSession(v)).toEqual(session);
  });

  it("fails closed on tampering (GCM auth) — reads as no session", () => {
    const v = vault();
    saveSession(session, v);
    const path = join(v.dir, "session.enc");
    const blob = JSON.parse(readFileSync(path, "utf8"));
    const flipped = Buffer.from(blob.data, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    blob.data = flipped.toString("base64");
    writeFileSync(path, JSON.stringify(blob));
    expect(loadSession(v)).toBeNull();
  });

  it("a different vault (different key) cannot read the session", () => {
    const a = vault();
    const b = vault();
    saveSession(session, a);
    // Copy ciphertext into b, which has its own key.
    writeFileSync(join(b.dir, "session.enc"), readFileSync(join(a.dir, "session.enc")));
    loadSession(b); // forces b to mint its own key
    expect(loadSession(b)).toBeNull();
  });

  it("honours a key from the named env var", () => {
    const dir = mkdtempSync(join(tmpdir(), "osk-vault-"));
    const key = Buffer.alloc(32, 7).toString("base64");
    process.env["OSK_TEST_KEY"] = key;
    try {
      const v: VaultOptions = { dir, keyEnvVar: "OSK_TEST_KEY" };
      saveSession(session, v);
      expect(loadSession(v)).toEqual(session);
    } finally {
      delete process.env["OSK_TEST_KEY"];
    }
  });

  it("clearSession removes it (the citizen disconnecting)", () => {
    const v = vault();
    saveSession(session, v);
    expect(clearSession(v)).toBe(true);
    expect(loadSession(v)).toBeNull();
    expect(clearSession(v)).toBe(false);
  });

  it("cookie helpers render header and named values", () => {
    expect(cookieHeader(session)).toBe("SESSION=abc123; XSRF-TOKEN=tok-1");
    expect(cookieValue(session, "XSRF-TOKEN")).toBe("tok-1");
    expect(cookieValue(session, "missing")).toBeUndefined();
  });
});
