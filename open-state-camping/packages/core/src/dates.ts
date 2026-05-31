/**
 * ISO-date ("YYYY-MM-DD") helpers, computed in UTC to avoid timezone drift.
 * Camping stays are whole nights, so a plain calendar date is the right unit.
 */
import type { ISODate } from "./types.js";

export function toUTCDate(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function fromUTCDate(dt: Date): ISODate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const dt = toUTCDate(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUTCDate(dt);
}

export function daysBetween(start: ISODate, end: ISODate): number {
  return Math.round(
    (toUTCDate(end).getTime() - toUTCDate(start).getTime()) / 86_400_000,
  );
}

/** Day of week in UTC: 0 = Sunday … 6 = Saturday (JS convention). */
export function weekday(iso: ISODate): number {
  return toUTCDate(iso).getUTCDay();
}
