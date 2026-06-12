/**
 * Notification channels (ntfy) and the guard that keeps `notify_target` from
 * being turned into an SSRF / open-relay primitive (docs/m2-validation-findings.md).
 */
import { isIP } from "node:net";
import { InvalidInputError } from "./errors.js";
import { randomTokenUrlSafe } from "./util.js";

const TOPIC_PREFIX = "openstate-";
const TOKEN_BYTES = 12;

export interface NotificationChannel {
  topic: string;
  /** Open in a browser or the ntfy app to subscribe (no sign-up needed). */
  subscribeUrl: string;
  /** Deep link that opens the ntfy mobile app straight to the topic. */
  appUrl: string;
}

/** Hosts a citizen-supplied `notifyTarget` may point at (ntfy base + extras). */
export function allowedNotifyHosts(opts: {
  ntfyBase: string;
  extraHosts?: readonly string[];
}): Set<string> {
  const hosts = new Set<string>();
  const base = safeHostname(opts.ntfyBase);
  if (base) hosts.add(base.toLowerCase());
  for (const h of opts.extraHosts ?? []) {
    if (h) hosts.add(h.toLowerCase());
  }
  return hosts;
}

/**
 * Reject a notification link we must not POST to, with a plain-language reason:
 * - no open relay (host must be on the allow-list);
 * - no SSRF (IP-literal targets in private/loopback/link-local ranges refused).
 * Throws `InvalidInputError`; returns when the target is safe.
 */
export function validateNotifyTarget(
  target: string,
  allowedHosts: ReadonlySet<string>,
): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new InvalidInputError(notAWebAddress());
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new InvalidInputError(notAWebAddress());
  }
  const host = url.hostname.toLowerCase();
  if (isBlockedIpLiteral(host)) {
    throw new InvalidInputError(
      "That notification link points at a private or internal address, so I " +
        "will not send to it. Use a public notification service such as an " +
        'ntfy.sh topic, or say "auto" and I will set up a private channel.',
    );
  }
  if (!allowedHosts.has(host)) {
    const allowed = [...allowedHosts].sort().join(", ") || "the configured ntfy host";
    throw new InvalidInputError(
      `For safety I only send notifications to ${allowed}. Say "auto" and ` +
        "I will set up a private channel for you, or set an alert without a " +
        "link and check back with list_alerts.",
    );
  }
}

/** Create a random, unguessable ntfy topic the citizen can subscribe to. */
export function generateChannel(ntfyBase: string): NotificationChannel {
  const topic = TOPIC_PREFIX + randomTokenUrlSafe(TOKEN_BYTES);
  const base = stripTrailingSlashes(ntfyBase);
  const host = safeHostname(base) || base;
  return {
    topic,
    subscribeUrl: `${base}/${topic}`,
    appUrl: `ntfy://${host}/${topic}`,
  };
}

/** POST a plain-text message to a citizen-controlled link. Best-effort. */
export async function sendMessage(
  target: string,
  message: string,
  opts: { title?: string; timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (opts.title) headers["Title"] = opts.title;
  const doFetch = opts.fetchFn ?? fetch;
  const resp = await doFetch(target, {
    method: "POST",
    body: message,
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  return resp.ok;
}

function notAWebAddress(): string {
  return (
    "The notification link must be a web address starting with http:// " +
    "or https:// that you control, such as an ntfy.sh topic link. You can " +
    'also say "auto" and I will set up a private channel for you, or set ' +
    "an alert without one and check back with list_alerts."
  );
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

/**
 * Strip trailing "/" via an index scan rather than a regex. The natural
 * `/\/+$/` is unanchored and so retried from every position, which is O(n²) on a
 * string of trailing slashes — a polynomial-ReDoS pattern CodeQL flags. This is
 * linear and allocates one slice.
 */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return s.slice(0, end);
}

/** IP-literal targets in private/loopback/link-local/reserved ranges (SSRF). */
function isBlockedIpLiteral(host: string): boolean {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const v = isIP(h);
  if (v === 4) {
    const o = h.split(".").map(Number) as [number, number, number, number];
    return (
      o[0] === 0 ||
      o[0] === 10 ||
      o[0] === 127 ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
    );
  }
  if (v === 6) {
    const lower = h.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fe80") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    );
  }
  return false;
}
