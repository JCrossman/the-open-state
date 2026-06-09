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

/** A backcountry product (a backcountry area/trip the citizen can choose). */
export interface BackcountryProduct {
  provider: string;
  recreationAreaId: string;
  productId: string;
  product: string;
  campgroundId: string;
}

/** A backcountry zone with its availability over the requested nights. */
export interface BackcountryZone {
  provider: string;
  recreationAreaId: string;
  productId: string;
  product: string;
  /** The facility (resourceLocationId), reused by the booking flow. */
  campgroundId: string;
  /** The zone resource (resourceId) — one itinerary leg books one zone per night. */
  zoneId: string;
  zoneName: string;
  accessible: boolean;
  /** Nights (YYYY-MM-DD) in the requested window that are available for this zone.
   *  (Backcountry availability is a status, not a count, so there's no spot tally.) */
  openNights: ISODate[];
}

/** A Day Use product the citizen can choose (one row of the Day Use tab). */
export interface DayUseProduct {
  provider: string;
  recreationAreaId: string;
  productId: string;
  product: string;
  campgroundId: string;
}

/** A bookable Day Use time-slot on a given day (shuttle departure, parking pass, …). */
export interface DayUseSlot {
  provider: string;
  recreationAreaId: string;
  /** The day-use product (its bookingCategoryId, as a string). */
  productId: string;
  product: string;
  /** The facility (resourceLocationId), reused by the booking flow. */
  campgroundId: string;
  /** The timed-slot resource (resourceId). */
  slotId: string;
  slotName: string;
  date: ISODate;
  /** Remaining reservable spots; a party needs at least its size here. */
  remaining: number;
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
