import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSession,
  cookieHeader,
  loadSession,
  saveSession,
  sessionAuthHeaders,
  xsrfToken,
  type Session,
} from "../src/session/vault.js";

function tempVault(): string {
  return mkdtempSync(join(tmpdir(), "osc-vault-"));
}

const session: Session = {
  provider: "parks_canada",
  cookies: [
    { name: "ASP.NET_SessionId", value: "s3cr3t-session-token", domain: "reservation.pc.gc.ca" },
    { name: "queue-it-token", value: "qit-abc123" },
  ],
  capturedAt: "2026-05-31T12:00:00Z",
};

describe("session vault", () => {
  it("round-trips a session through encryption", () => {
    const dir = tempVault();
    try {
      expect(loadSession(dir)).toBeNull();
      saveSession(session, dir);
      expect(loadSession(dir)).toEqual(session);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("encrypts at rest — the cookie value is not on disk in cleartext", () => {
    const dir = tempVault();
    try {
      saveSession(session, dir);
      const onDisk = readFileSync(join(dir, "session.enc"), "utf8");
      expect(onDisk).not.toContain("s3cr3t-session-token");
      expect(onDisk).not.toContain("ASP.NET_SessionId");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the vault is tampered with (GCM auth fails)", () => {
    const dir = tempVault();
    try {
      saveSession(session, dir);
      const path = join(dir, "session.enc");
      const blob = JSON.parse(readFileSync(path, "utf8"));
      // Flip a byte of the ciphertext.
      const data = Buffer.from(blob.data, "base64");
      data[0] = data[0]! ^ 0xff;
      blob.data = data.toString("base64");
      writeFileSync(path, JSON.stringify(blob));
      expect(loadSession(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears the session", () => {
    const dir = tempVault();
    try {
      saveSession(session, dir);
      expect(clearSession(dir)).toBe(true);
      expect(loadSession(dir)).toBeNull();
      expect(clearSession(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders cookies as a Cookie header", () => {
    expect(cookieHeader(session)).toBe(
      "ASP.NET_SessionId=s3cr3t-session-token; queue-it-token=qit-abc123",
    );
  });

  it("derives Cookie + X-XSRF-TOKEN auth headers, echoing the XSRF cookie", () => {
    const withXsrf: Session = {
      ...session,
      cookies: [...session.cookies, { name: "XSRF-TOKEN", value: "csrf-9z" }],
    };
    expect(xsrfToken(withXsrf)).toBe("csrf-9z");
    const headers = sessionAuthHeaders(withXsrf);
    expect(headers["X-XSRF-TOKEN"]).toBe("csrf-9z");
    expect(headers["Cookie"]).toContain("XSRF-TOKEN=csrf-9z");
  });

  it("omits X-XSRF-TOKEN when no XSRF cookie is present", () => {
    expect(xsrfToken(session)).toBeUndefined();
    expect(sessionAuthHeaders(session)["X-XSRF-TOKEN"]).toBeUndefined();
  });
});
