import { describe, expect, it } from "vitest";
import {
  GoingToCampClient,
  QueueItError,
  generateChannel,
  type FetchLike,
} from "../src/index.js";

/**
 * Regression tests for the CodeQL High findings fixed alongside this file:
 *  - Queue-it detection by hostname, not substring (incomplete-url-substring).
 *  - Trailing-slash strip without a polynomial-ReDoS regex.
 */

/** A fake fetch whose Response carries a real `.url` (which `new Response()` can't set). */
function fetchReturning(url: string, body: unknown, status = 200): FetchLike {
  return (async () =>
    ({
      url,
      status,
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    }) as unknown as Response) as FetchLike;
}

function clientWith(fetchFn: FetchLike): GoingToCampClient {
  return new GoingToCampClient({ hostname: "reservation.pc.gc.ca", userAgent: "test", fetchFn });
}

describe("Queue-it detection is by hostname, not substring", () => {
  it("treats a real *.queue-it.net waiting room as Queue-it", async () => {
    const client = clientWith(fetchReturning("https://parkscanada.queue-it.net/?c=x", []));
    await expect(client.listFacilities()).rejects.toBeInstanceOf(QueueItError);
  });

  it("does NOT treat a Parks Canada URL that merely contains the string as Queue-it", async () => {
    // The old substring check (`resp.url.includes("queue-it.net")`) would have
    // wrongly thrown QueueItError here — the host is reservation.pc.gc.ca.
    const client = clientWith(
      fetchReturning("https://reservation.pc.gc.ca/r?next=queue-it.net", []),
    );
    await expect(client.listFacilities()).resolves.toEqual([]);
  });

  it("a bare invalid response URL is not Queue-it (parses safely)", async () => {
    const client = clientWith(fetchReturning("", []));
    await expect(client.listFacilities()).resolves.toEqual([]);
  });
});

describe("generateChannel strips trailing slashes (no ReDoS regex)", () => {
  it("collapses one or many trailing slashes to a single join", () => {
    for (const base of ["https://ntfy.sh", "https://ntfy.sh/", "https://ntfy.sh/////"]) {
      const ch = generateChannel(base);
      expect(ch.subscribeUrl).toMatch(/^https:\/\/ntfy\.sh\/openstate-[A-Za-z0-9_-]+$/);
      expect(ch.subscribeUrl).not.toContain("ntfy.sh//"); // no doubled slash after the host
      expect(ch.appUrl).toMatch(/^ntfy:\/\/ntfy\.sh\/openstate-/);
    }
  });

  it("stays linear on a pathological all-slashes input (no catastrophic backtracking)", () => {
    const started = Date.now();
    const ch = generateChannel("https://ntfy.sh" + "/".repeat(100_000));
    expect(ch.subscribeUrl.startsWith("https://ntfy.sh/openstate-")).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000); // would blow up if O(n^2) backtracking
  });
});
