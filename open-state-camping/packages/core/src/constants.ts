/**
 * Platform constants for GoingToCamp / Camis (Parks Canada), verified live.
 * See docs/parks-canada-api-findings.md.
 */

export const PARKS_CANADA_REC_AREA_ID = "14";
export const PARKS_CANADA_HOSTNAME = "reservation.pc.gc.ca";
export const PARKS_CANADA_NAME = "Parks Canada";

// Resource categories that represent reservable campsites.
export const CAMP_SITE = -2147483648;
export const OVERFLOW_SITE = -2147483647;
export const GROUP_SITE = -2147483643;
export const CAMPSITE_CATEGORIES: ReadonlySet<number> = new Set([
  CAMP_SITE,
  OVERFLOW_SITE,
  GROUP_SITE,
]);

// The non-group equipment category id used by availability and booking calls.
export const NON_GROUP_EQUIPMENT = -32768;

// Accessibility attribute: value 0 = Yes (accessible), 1 = No.
export const ACCESSIBLE_ATTR = -32756;
// Service-type attribute (different namespace from equipment).
export const SERVICE_TYPE_ATTR = -32768;

// Recursion safety: a single campground search never fans out beyond this many
// map requests (politeness + loop guard).
export const MAX_MAP_REQUESTS = 50;

// Browser-like UA: Parks Canada returns HTTP 403 to non-browser User-Agents.
// (docs/parks-canada-api-findings.md "Access conditions".)
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
