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

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Short weekday label for a date, e.g. "Wed". */
export function weekdayName(iso: ISODate): string {
  return WEEKDAY_NAMES[weekday(iso)]!;
}

/** Today's date (UTC) as an ISO string — the tool runs on the citizen's machine,
 *  so this is the real current date, which the assistant's prose can drift from. */
export function todayUTC(): ISODate {
  return fromUTCDate(new Date());
}

/**
 * The next occurrence of a date's month/day that is not in the past. Used to
 * suggest the right year when a bare "June 17" was resolved to a past year:
 * keeps the month/day, advances the year to today's (or next year if that day
 * has already passed this year).
 */
export function nextOccurrence(iso: ISODate, today: ISODate = todayUTC()): ISODate {
  const [, m, d] = iso.split("-");
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${m}-${d}`;
  return candidate < today ? `${year + 1}-${m}-${d}` : candidate;
}
