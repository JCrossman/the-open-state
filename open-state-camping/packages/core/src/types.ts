/**
 * Normalized, platform-agnostic shapes the rest of the system depends on.
 * Concrete providers (Parks Canada now, Alberta later) map their native data
 * into these. Identifiers cross the boundary as strings to stay platform-neutral.
 */

/** An ISO calendar date, "YYYY-MM-DD". */
export type ISODate = string;

export interface Campground {
  provider: string;
  recreationAreaId: string;
  campgroundId: string;
  name: string;
  /** Booking groups this campground offers (e.g. "Frontcountry Camping",
   *  "Accommodations"), for orienting the citizen among the kinds of stay. */
  offers?: string[];
}

export interface RecreationArea {
  provider: string;
  recreationAreaId: string;
  name: string;
  description?: string;
  campgrounds: Campground[];
}

export interface EquipmentType {
  provider: string;
  recreationAreaId: string;
  equipmentId: string;
  name: string;
}

export interface AvailableSite {
  provider: string;
  recreationArea: string;
  recreationAreaId: string;
  campground: string;
  campgroundId: string;
  campsiteId: string;
  siteName: string;
  /** First-class accessibility signal (Constitution Art. 3). */
  accessible: boolean;
  availableDates: ISODate[];
  loopName?: string;
  siteType?: string;
  maxOccupancy?: number;
  /** Not exposed by Parks Canada's read API; left undefined and flagged. */
  price?: number;
  bookingUrl?: string;
}

export interface SiteDetails {
  provider: string;
  recreationAreaId: string;
  campsiteId: string;
  siteName: string;
  accessible: boolean;
  description?: string;
  amenities: string[];
  accessibilityNotes: string[];
  photos: string[];
  maxOccupancy?: number;
  siteType?: string;
}

/**
 * How many open sites one campground has, for a park-wide search. `error` is set
 * when that one campground could not be checked, so a single failure is visible
 * without sinking the whole search.
 */
export interface CampgroundAvailability {
  provider: string;
  recreationAreaId: string;
  campgroundId: string;
  campgroundName: string;
  openSiteCount: number;
  accessibleCount: number;
  error?: string;
}
