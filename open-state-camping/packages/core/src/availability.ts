/**
 * Per-night stay evaluation, ported from the verified Python implementation.
 * `availability == 0` means a night is open (docs/parks-canada-api-findings.md).
 */
import type { ISODate } from "./types.js";
import { addDays, daysBetween, weekday } from "./dates.js";

// JS getUTCDay() convention: Sunday = 0 … Saturday = 6.
const FRIDAY = 5;
const SATURDAY = 6;

/** The nights of the stay: arrival up to (not including) departure. */
export function windowNights(start: ISODate, end: ISODate): ISODate[] {
  const count = daysBetween(start, end);
  if (count <= 0) return [start];
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** Nights in the window the platform reports as open (code 0). */
export function openNights(
  window: ISODate[],
  dayCodes: (number | null)[],
): ISODate[] {
  return window.filter((_, i) => i < dayCodes.length && dayCodes[i] === 0);
}

export interface StayEvaluation {
  qualifies: boolean;
  dates: ISODate[];
}

/**
 * Decide if a site qualifies, and which nights justify it.
 * - default: every night of the window must be open;
 * - `nights = N`: a run of at least N consecutive open nights within the window;
 * - `weekendsOnly`: the Friday/Saturday nights in the window must be open.
 */
export function evaluateStay(
  openN: ISODate[],
  window: ISODate[],
  nights: number | null | undefined,
  weekendsOnly: boolean,
): StayEvaluation {
  const openSet = new Set(openN);

  if (weekendsOnly) {
    const weekend = window.filter((n) => {
      const wd = weekday(n);
      return wd === FRIDAY || wd === SATURDAY;
    });
    if (weekend.length > 0 && weekend.every((n) => openSet.has(n))) {
      return { qualifies: true, dates: weekend };
    }
    return { qualifies: false, dates: [] };
  }

  if (nights && nights > 0) {
    let best: ISODate[] = [];
    let run: ISODate[] = [];
    for (const night of window) {
      run = openSet.has(night) ? [...run, night] : [];
      if (run.length > best.length) best = run;
    }
    if (best.length >= nights) return { qualifies: true, dates: best };
    return { qualifies: false, dates: [] };
  }

  if (window.length > 0 && window.every((n) => openSet.has(n))) {
    return { qualifies: true, dates: [...window] };
  }
  return { qualifies: false, dates: [] };
}

/**
 * Compare site names so numeric names order numerically, then text alphabetically.
 * Mirrors the Python `_name_sort_key` tuple `(0, int)` < `(1, str)`.
 */
export function compareSiteNames(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
}
