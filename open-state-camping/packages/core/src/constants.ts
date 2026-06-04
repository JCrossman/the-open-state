/**
 * Platform constants for GoingToCamp / Camis (Parks Canada), verified live.
 * See docs/parks-canada-api-findings.md.
 */

export const PARKS_CANADA_REC_AREA_ID = "14";
export const PARKS_CANADA_HOSTNAME = "reservation.pc.gc.ca";
export const PARKS_CANADA_NAME = "Parks Canada";

// Resource categories (verified against GET /api/resourcecategory). Each resource
// carries a `resourceCategoryId`; `resourceType` groups them by booking model
// (0 = a site reserved for nights, 2 = day-use time slot, 3 = backcountry).
export const RESOURCE_CATEGORY = {
  campsite: -2147483648,
  overflow: -2147483641,
  group: -2147483640,
  seasonal: -2147483624,
  // Accommodations (roofed / equipped — all reserved for nights, model 0).
  yurt: -2147483647,
  otentik: -2147483643,
  oasis: -2147483644,
  rusticCabin: -2147483645,
  cabin: -2147483646,
  microcube: -2147483642,
  prospectorTent: -2147483630,
  teepee: -2147483631,
  equippedCamping: -2147483635,
} as const;

export const CAMP_SITE = RESOURCE_CATEGORY.campsite;

/**
 * The booking "groups" a citizen searches, each a set of resource category ids.
 * Frontcountry "Campsite", "Group Campsite", and "Accommodations" are all model 0
 * (a specific site reserved for nights) and share the search/booking machinery.
 */
export const CATEGORY_GROUPS = {
  campsite: new Set<number>([
    RESOURCE_CATEGORY.campsite,
    RESOURCE_CATEGORY.overflow,
    RESOURCE_CATEGORY.seasonal,
  ]),
  group: new Set<number>([RESOURCE_CATEGORY.group]),
  accommodation: new Set<number>([
    RESOURCE_CATEGORY.yurt,
    RESOURCE_CATEGORY.otentik,
    RESOURCE_CATEGORY.oasis,
    RESOURCE_CATEGORY.rusticCabin,
    RESOURCE_CATEGORY.cabin,
    RESOURCE_CATEGORY.microcube,
    RESOURCE_CATEGORY.prospectorTent,
    RESOURCE_CATEGORY.teepee,
    RESOURCE_CATEGORY.equippedCamping,
  ]),
} as const;
export type CategoryGroup = keyof typeof CATEGORY_GROUPS;

/** The `bookingCategoryId` the platform expects at commit for each group. */
export const BOOKING_CATEGORY_ID: Record<CategoryGroup, number> = {
  campsite: 0,
  accommodation: 1,
  group: 2,
};

/** Every model-0 site category — used to decide which facilities are bookable. */
export const ALL_SITE_CATEGORIES: ReadonlySet<number> = new Set<number>([
  ...CATEGORY_GROUPS.campsite,
  ...CATEGORY_GROUPS.group,
  ...CATEGORY_GROUPS.accommodation,
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
