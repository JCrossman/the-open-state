/** Local bundle configuration, from environment with safe defaults. */
import { PARKS_CANADA_REC_AREA_ID } from "@open-state/core";

/** Camply/GoingToCamp politeness floor: never poll faster than this. */
export const POLL_INTERVAL_MIN_MINUTES = 5;

export interface BundleConfig {
  userAgent?: string;
  timeoutMs: number;
  recreationAreaId: string;
  /** Max concurrent cancellation watches (each is polled, so it's bounded load). */
  maxActiveAlerts: number;
  /** Minutes between alert polls; floored at POLL_INTERVAL_MIN_MINUTES. */
  pollIntervalMinutes: number;
  /** Base for auto-provisioned notification channels (ntfy needs no sign-up). */
  ntfyBase: string;
  /** Extra hosts a citizen-supplied notify_target may point at, beyond ntfyBase. */
  notifyAllowedHosts: string[];
}

export function configFromEnv(): BundleConfig {
  const timeout = Number(process.env["OPEN_STATE_HTTP_TIMEOUT_MS"] ?? "30000");
  const interval = Number(process.env["OPEN_STATE_POLL_INTERVAL_MINUTES"] ?? "10");
  const cap = Number(process.env["OPEN_STATE_MAX_ALERTS"] ?? "25");
  return {
    userAgent: process.env["OPEN_STATE_USER_AGENT"],
    timeoutMs: Number.isFinite(timeout) ? timeout : 30_000,
    recreationAreaId: PARKS_CANADA_REC_AREA_ID,
    maxActiveAlerts: Number.isFinite(cap) && cap > 0 ? cap : 25,
    pollIntervalMinutes: Math.max(
      POLL_INTERVAL_MIN_MINUTES,
      Number.isFinite(interval) ? interval : 10,
    ),
    ntfyBase: process.env["OPEN_STATE_NTFY_BASE"] ?? "https://ntfy.sh",
    notifyAllowedHosts: (process.env["OPEN_STATE_NOTIFY_ALLOWED_HOSTS"] ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  };
}
