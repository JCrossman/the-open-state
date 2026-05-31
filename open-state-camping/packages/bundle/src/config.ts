/** Local bundle configuration, from environment with safe defaults. */
import { PARKS_CANADA_REC_AREA_ID } from "@open-state/core";

export interface BundleConfig {
  userAgent?: string;
  timeoutMs: number;
  recreationAreaId: string;
}

export function configFromEnv(): BundleConfig {
  const timeout = Number(process.env["OPEN_STATE_HTTP_TIMEOUT_MS"] ?? "30000");
  return {
    userAgent: process.env["OPEN_STATE_USER_AGENT"],
    timeoutMs: Number.isFinite(timeout) ? timeout : 30_000,
    recreationAreaId: PARKS_CANADA_REC_AREA_ID,
  };
}
