/**
 * Booking cart assembly for the GoingToCamp / Camis platform (Parks Canada).
 *
 * This builds the `cart` object that `POST /api/cart/commit` accepts. The booking
 * wizard re-commits the whole cart object at each step (hold → account → occupant
 * → party → policies), so we assemble the *fully populated, pre-payment* cart and
 * commit it. We deliberately stop before payment: the citizen enters their card in
 * their own browser (Constitution Art. 2 — "prepare fully → citizen confirms").
 *
 * Verified against a real authenticated capture (docs/parks-canada-api-findings.md,
 * "Booking write path"). Following the hard-won lesson from the profile-update work,
 * the occupant is the citizen's *real* shopper record copied and mutated — never a
 * DTO reconstructed field-by-field — and `cart.shopper` is the raw GET /api/shopper
 * envelope, threaded back unchanged.
 */
import { randomUUID } from "node:crypto";
import type { ISODate } from "./types.js";
import { NON_GROUP_EQUIPMENT } from "./constants.js";

/** Default rate category (standard rate), check-in/out from the resource model. */
const DEFAULT_RATE_CATEGORY_ID = -32768;
const DEFAULT_CHECK_IN_TIME = "14:00";
const DEFAULT_CHECK_OUT_TIME = "11:00";
/** Day Use (model 1) covers the whole open day, not an overnight window. */
const DAY_USE_CHECK_IN_TIME = "10:00";
const DAY_USE_CHECK_OUT_TIME = "23:59";
/** Backcountry (model 5) check-in/out times. */
const BACKCOUNTRY_CHECK_IN_TIME = "12:00";
const BACKCOUNTRY_CHECK_OUT_TIME = "11:00";

/** Booking models that share this cart machinery (verified live / from HAR). */
export const BOOKING_MODEL = { site: 0, dayUse: 1, backcountry: 5 } as const;

/** Party capacity sub-categories (verified): the four age bands the wizard shows. */
export const CAPACITY_CATEGORY_ID = -32767;
export const CAPACITY_SUB = {
  adult: -32768,
  senior: -32767,
  youth: -32766,
  child: -32765,
} as const;

/** Number of people in each age band. `adults` defaults to 1 (a booking needs one). */
export interface PartyCounts {
  adults: number;
  seniors?: number;
  youth?: number;
  children?: number;
}

/** Everything that identifies *what* is being booked. */
export interface BookingRequest {
  /** The chosen campsite (`resourceId`). */
  resourceId: number;
  /** The campground the site belongs to (`resourceLocationId`). */
  resourceLocationId: number;
  startDate: ISODate;
  endDate: ISODate;
  party: PartyCounts;
  equipmentCategoryId?: number;
  subEquipmentCategoryId?: number;
  rateCategoryId?: number;
  checkInTime?: string;
  checkOutTime?: string;
  /** Booking category for the commit: 0 campsite (default), 1 accommodation, 2 group. */
  bookingCategoryId?: number;
  /** Booking model: 0 = site/nights (default), 1 = Day Use time-slot, 5 = Backcountry. */
  bookingModel?: number;
  /** Backcountry zone permit: the entry-point (trailhead) resource you start from. */
  entryPointResourceId?: number;
  /** Backcountry zone permit: the zone's own capacity category (adds a counts entry). */
  zoneCapacityCategoryId?: number;
  /**
   * Backcountry (model 5) itinerary: one leg per night (a zone for a date range).
   * When set, the booking spans every leg and each leg becomes a resource blocker;
   * `resourceId`/`startDate`/`endDate` on the request are ignored in favour of the legs.
   */
  itinerary?: Array<{
    resourceId: number;
    startDate: ISODate;
    endDate: ISODate;
    /** Platform resourceModel (0 Site / 2 Zone). Decides site vs quota hold. */
    resourceModel?: number;
  }>;
}

/**
 * The client-generated GUIDs that tie a cart together. The Angular app mints these
 * locally before the first commit (the first commit *is* the hold); we do the same.
 */
export interface BookingIds {
  bookingUid: string;
  resourceBlockerUid: string;
  /** Day Use holds the slot via a zone blocker instead of a resource blocker. */
  resourceZoneBlockerUid: string;
}

/**
 * Mint the client-generated GUIDs for a booking. The `cartUid` and
 * `cartTransactionUid` are *server*-issued (GET /api/cart → GET
 * /api/cart/newtransaction), so we only generate the booking and blocker ids.
 */
export function newBookingIds(): BookingIds {
  return {
    bookingUid: randomUUID(),
    resourceBlockerUid: randomUUID(),
    resourceZoneBlockerUid: randomUUID(),
  };
}

/** Build the four capacity-count entries from a plain party description. */
export function partyCapacityCounts(party: PartyCounts): Array<{
  capacityCategoryId: number;
  count: number;
  subCapacityCategoryId: number;
}> {
  return [
    { capacityCategoryId: CAPACITY_CATEGORY_ID, count: party.adults, subCapacityCategoryId: CAPACITY_SUB.adult },
    { capacityCategoryId: CAPACITY_CATEGORY_ID, count: party.seniors ?? 0, subCapacityCategoryId: CAPACITY_SUB.senior },
    { capacityCategoryId: CAPACITY_CATEGORY_ID, count: party.youth ?? 0, subCapacityCategoryId: CAPACITY_SUB.youth },
    { capacityCategoryId: CAPACITY_CATEGORY_ID, count: party.children ?? 0, subCapacityCategoryId: CAPACITY_SUB.child },
  ];
}

/**
 * Capacity counts for a backcountry *zone* permit. The four age-band entries carry an
 * `isAdult` flag, and a fifth entry totals the party under the zone's own capacity
 * category (verified vs a captured Forillon zone booking). `count` on that fifth entry
 * is the whole party; `subCapacityCategoryId` is null.
 */
export function zoneCapacityCounts(
  party: PartyCounts,
  zoneCapacityCategoryId?: number,
): Array<Record<string, unknown>> {
  const counts: Array<Record<string, unknown>> = [
    { capacityCategoryId: CAPACITY_CATEGORY_ID, subCapacityCategoryId: CAPACITY_SUB.adult, count: party.adults, isAdult: true },
    { capacityCategoryId: CAPACITY_CATEGORY_ID, subCapacityCategoryId: CAPACITY_SUB.senior, count: party.seniors ?? 0, isAdult: true },
    { capacityCategoryId: CAPACITY_CATEGORY_ID, subCapacityCategoryId: CAPACITY_SUB.youth, count: party.youth ?? 0, isAdult: false },
    { capacityCategoryId: CAPACITY_CATEGORY_ID, subCapacityCategoryId: CAPACITY_SUB.child, count: party.children ?? 0, isAdult: false },
  ];
  if (zoneCapacityCategoryId != null) {
    counts.push({ capacityCategoryId: zoneCapacityCategoryId, subCapacityCategoryId: null, count: partySize(party) });
  }
  return counts;
}

/** Total heads in the party (used for plain-language summaries and validation). */
export function partySize(party: PartyCounts): number {
  return party.adults + (party.seniors ?? 0) + (party.youth ?? 0) + (party.children ?? 0);
}

/**
 * The raw `GET /api/shopper` envelope: `{ shopperUid, currentVersion: {…profile…},
 * history, hasWebAccount, … }`. The booking needs the whole envelope (threaded into
 * `cart.shopper`) and the flat profile (copied into the occupant).
 */
export interface ShopperEnvelope {
  shopperUid: string;
  currentVersion: Record<string, any>;
  [key: string]: unknown;
}

/**
 * Build the occupant block from the citizen's real profile. The occupant is the
 * person the permit is issued to; for "I am the occupant" it's a *projection* of
 * the shopper's own `currentVersion` (verified against a real capture): the
 * profile's `addresses[0]`, `contact`, and `phoneNumbers` objects are copied
 * across unchanged (preserving server-managed shapes — region codes, phone
 * country codes, E.164 numbers), and `copiedShopperUid` ties it back to the
 * account. Marketing/emergency-SMS consent defaults to `false`
 * (privacy-preserving; Constitution data-minimization).
 */
export function buildOccupant(envelope: ShopperEnvelope): Record<string, any> {
  const p = envelope.currentVersion;
  const addresses: any[] = Array.isArray(p["addresses"]) ? p["addresses"] : [];
  const address = addresses[0]
    ? structuredClone(addresses[0])
    : { description: null, unit: null, streetAddress: "", city: "", region: "", regionCode: "", country: "" };
  const contact = p["contact"]
    ? structuredClone(p["contact"])
    : { contactName: "", phoneNumberCountryCode: null, phoneNumber: "", email: "" };
  const phoneNumbers = p["phoneNumbers"]
    ? structuredClone(p["phoneNumbers"])
    : { primaryPhoneNumber: "", primaryCountryCode: null, secondaryPhoneNumber: null, secondaryCountryCode: null };
  return {
    bookingCustomerChainUid: null,
    copiedShopperUid: envelope.shopperUid,
    lastName: p["lastName"] ?? "",
    firstName: p["firstName"] ?? "",
    email: p["email"] ?? "",
    allowMarketing: false,
    allowEmergencySms: false,
    preferredCultureName: p["preferredCultureName"] ?? "en-CA",
    address,
    contact,
    phoneNumbers,
    defaultRateCategoryId: p["defaultRateCategoryId"] ?? null,
    defaultPassNumber: p["defaultPassNumber"] ?? "",
  };
}

/** The booking holder, derived from the citizen's profile (one named member). */
export function bookingHolderMember(envelope: ShopperEnvelope): Record<string, any> {
  const p = envelope.currentVersion;
  return {
    firstName: p["firstName"] ?? "",
    lastName: p["lastName"] ?? "",
    age: null,
    notes: "",
    isBookingHolder: true,
    annualPassNumber: "",
    capacityCategoryId: null,
    subCapacityCategoryId: null,
    order: 0,
    startDate: null,
    endDate: null,
    contact: null,
  };
}

/**
 * The stub occupant the wizard sends on the very first commit (the hold), before
 * the citizen's profile is loaded into the form: name + culture only, with empty
 * contact/address/phone shapes. Replaced by the full projection at the next stage.
 */
export function minimalOccupant(envelope: ShopperEnvelope): Record<string, any> {
  const p = envelope.currentVersion;
  return {
    contact: { email: "", contactName: "", phoneNumberCountryCode: null, phoneNumber: "" },
    address: {},
    allowMarketing: false,
    phoneNumbers: {},
    preferredCultureName: p["preferredCultureName"] ?? "en-CA",
    firstName: p["firstName"] ?? "",
    lastName: p["lastName"] ?? "",
  };
}

/**
 * The wizard's commit stages, in order. The platform's booking wizard re-commits
 * the cart at each screen; replaying the same progression (rather than a single
 * fully-populated commit) mirrors what the server validated step by step:
 *  - `hold`     — place the hold (stub occupant, no check-in times, no members).
 *  - `details`  — account/occupant/party screens (full occupant, check-in times).
 *  - `finalize` — ready for payment (adds the booking-holder member).
 */
export type BookingStage = "hold" | "details" | "finalize";
export const BOOKING_STAGES: readonly BookingStage[] = ["hold", "details", "finalize"];

/**
 * How a resource is held, from the platform's `resourceModel` (verified in the SPA):
 * Site books a specific unit (`resourceBlocker`); Zone is quota-based and books N of a
 * shared capacity (`resourceZoneBlocker` with `unitsBlocked`). Day Use slots and many
 * backcountry zones are Zone; frontcountry sites and backcountry campsites are Site.
 */
export const RESOURCE_MODEL = { site: 0, nonSpecific: 1, zone: 2, accessPoint: 3, zoneEntry: 4 } as const;

/** One itinerary leg: a resource (site or backcountry zone) held for a date range. */
interface BlockerLeg {
  uid: string;
  resourceId: number;
  startDate: ISODate;
  endDate: ISODate;
  resourceModel: number;
}

/** Identify the booking within a specific server-issued transaction. */
interface BookingRefs {
  bookingUid: string;
  cartUid: string;
  cartTransactionUid: string;
  /** Hold UIDs the booking references, split by kind (sites vs quota zones). */
  resourceBlockerUids: string[];
  resourceZoneBlockerUids: string[];
}

/** A site hold (resource blocker) for one leg and its date range (resourceModel Site). */
export function buildResourceBlocker(
  leg: BlockerLeg,
  resourceLocationId: number,
  refs: BookingRefs,
): Record<string, any> {
  return {
    blockerType: 0,
    cartUid: refs.cartUid,
    resourceBlockerUid: leg.uid,
    bookingUid: refs.bookingUid,
    groupHoldUid: "",
    isReservation: true,
    newVersion: {
      creationDate: new Date().toISOString(),
      cartTransactionUid: refs.cartTransactionUid,
      completedDate: null,
      blockerTransactionStatus: 0,
      startDate: leg.startDate,
      endDate: leg.endDate,
      resourceId: leg.resourceId,
      resourceLocationId,
      status: 0,
    },
  };
}

/**
 * The quota hold (resource *zone* blocker) for one leg. Records `unitsBlocked` (spots
 * taken from the zone's shared capacity) and lands in the cart's `resourceZoneBlockers`.
 * Used by Day Use slots and backcountry Zone permits (resourceModel Zone).
 */
export function buildResourceZoneBlocker(
  leg: BlockerLeg,
  resourceLocationId: number,
  unitsBlocked: number,
  refs: BookingRefs,
  lean = false,
): Record<string, any> {
  // Day Use zone blockers carry blockerTransactionStatus + completedDate (newVersion)
  // and currentVersion/history/drafts/adminCartUid (top level); backcountry zone
  // blockers omit ALL of those (verified vs the respective captures). `lean` = backcountry.
  const newVersion: Record<string, any> = {
    cartTransactionUid: refs.cartTransactionUid,
    creationDate: new Date().toISOString(),
    status: 0,
    resourceLocationId,
    resourceId: leg.resourceId,
    startDate: leg.startDate,
    endDate: leg.endDate,
    unitsBlocked,
  };
  if (!lean) {
    newVersion["blockerTransactionStatus"] = 0;
    newVersion["completedDate"] = null;
  }
  const blocker: Record<string, any> = {
    blockerType: 0,
    cartUid: refs.cartUid,
    resourceZoneBlockerUid: leg.uid,
    bookingUid: refs.bookingUid,
    groupHoldUid: null,
    isReservation: true,
    newVersion,
  };
  if (!lean) {
    blocker["currentVersion"] = null;
    blocker["history"] = [];
    blocker["drafts"] = [];
    blocker["adminCartUid"] = null;
  }
  return blocker;
}

/** The booking object (one site, one stay) added to the cart's `bookings`. */
export function buildBooking(
  request: BookingRequest,
  refs: BookingRefs,
  envelope: ShopperEnvelope,
  stage: BookingStage,
): Record<string, any> {
  const isHold = stage === "hold";
  const model = request.bookingModel ?? BOOKING_MODEL.site;
  const isDayUse = model === BOOKING_MODEL.dayUse;
  const isBackcountry = model === BOOKING_MODEL.backcountry;
  // Equipment: Day Use carries none. Backcountry is product-dependent — the caller
  // supplies the zone's equipment when it has one (Backcountry Campsite), and omits it
  // when it doesn't (Backcountry Zone permits carry no equipment), so default to null
  // rather than forcing a category. Frontcountry sites default to non-group equipment.
  const equipmentCategoryId = isDayUse
    ? null
    : isBackcountry
      ? (request.equipmentCategoryId ?? null)
      : (request.equipmentCategoryId ?? NON_GROUP_EQUIPMENT);
  const subEquipmentCategoryId = isDayUse
    ? null
    : isBackcountry
      ? (request.subEquipmentCategoryId ?? null)
      : (request.subEquipmentCategoryId ?? NON_GROUP_EQUIPMENT);
  const checkIn = isDayUse
    ? DAY_USE_CHECK_IN_TIME
    : isBackcountry
      ? BACKCOUNTRY_CHECK_IN_TIME
      : DEFAULT_CHECK_IN_TIME;
  const checkOut = isDayUse
    ? DAY_USE_CHECK_OUT_TIME
    : isBackcountry
      ? BACKCOUNTRY_CHECK_OUT_TIME
      : DEFAULT_CHECK_OUT_TIME;
  // The booking spans the whole stay; the caller sets request dates to first leg's
  // start and last leg's end for an itinerary.
  const startDate = request.startDate;
  const endDate = request.endDate;
  // A backcountry *zone* permit (quota zone with an entry trailhead) differs from a
  // backcountry *campsite*: it sends null check-in/out, an entry point, and an extra
  // capacity count keyed by the zone's own capacity category (verified vs a captured
  // Forillon zone booking).
  const isZonePermit = isBackcountry && request.entryPointResourceId != null;
  // Backcountry campsites & Day Use send fixed check-in/out at every stage; zone
  // permits send null; overnight sites take them from the resource model after the hold.
  const fixedTimes = (isDayUse || isBackcountry) && !isZonePermit;
  const newVersion: Record<string, any> = {
    cartTransactionUid: refs.cartTransactionUid,
    bookingMembers: stage === "finalize" ? [bookingHolderMember(envelope)] : [],
    bookingVehicles: [],
    bookingBoats: [],
    bookingCapacityCategoryCounts: isZonePermit
      ? zoneCapacityCounts(request.party, request.zoneCapacityCategoryId)
      : partyCapacityCounts(request.party),
    rateCategoryId: request.rateCategoryId ?? DEFAULT_RATE_CATEGORY_ID,
    resourceBlockerUids: refs.resourceBlockerUids,
    resourceNonSpecificBlockerUids: [],
    resourceZoneBlockerUids: refs.resourceZoneBlockerUids,
    resourceZoneEntryBlockerUids: [],
    startDate,
    endDate,
    releasePersonalInformation: false,
    equipmentCategoryId,
    subEquipmentCategoryId,
    occupant: isHold ? minimalOccupant(envelope) : buildOccupant(envelope),
    requiresCheckout: false,
    bookingStatus: 0,
    completedDate: isHold ? new Date().toISOString() : null,
    arrivalComment: "",
    entryPointResourceId: request.entryPointResourceId ?? null,
    exitPointResourceId: null,
    bookingSurcharges: [],
    consentToRelease: false,
    equipmentDescription: "",
    groupHoldUid: null,
    organizationName: "",
    passExpiryDate: null,
    passNumber: "",
    resourceLocationId: request.resourceLocationId,
    checkInTime: isZonePermit ? null : fixedTimes ? checkIn : isHold ? null : (request.checkInTime ?? checkIn),
    checkOutTime: isZonePermit ? null : fixedTimes ? checkOut : isHold ? null : (request.checkOutTime ?? checkOut),
    deferredPayment: false,
  };
  return {
    bookingUid: refs.bookingUid,
    cartUid: refs.cartUid,
    bookingCategoryId: request.bookingCategoryId ?? 0,
    bookingModel: request.bookingModel ?? BOOKING_MODEL.site,
    newVersion,
    createTransactionUid: refs.cartTransactionUid,
    currentVersion: null,
    history: [],
    drafts: [],
    referenceNumberPostfix: "",
  };
}

/**
 * Add the booking to the server-issued cart and return it ready to commit.
 *
 * `base` is the real cart from `GET /api/cart/newtransaction` — it already carries
 * the server's transaction context (`cartTransactionUid`, `shiftUid`, `userUid`,
 * `referenceNumberPrefix`, the online terminal). We mutate *that* object (attach
 * the shopper, the booking, and the hold) rather than fabricating a cart, because
 * fabricating the transaction is rejected with HTTP 400. Mirrors the SPA, which
 * gets a new transaction, populates the shopper, then adds the booking and commits.
 */
export function buildBookingCart(
  base: Record<string, any>,
  request: BookingRequest,
  ids: BookingIds,
  envelope: ShopperEnvelope,
  stage: BookingStage = "finalize",
): { cart: Record<string, any> } {
  const cart = base;
  const cartUid = cart["cartUid"] as string;
  const cartTransactionUid =
    (cart["newTransaction"]?.["cartTransactionUid"] as string) ??
    (cart["createTransactionUid"] as string);

  // Attach the shopper, mirroring the SPA's populateShopperOnCart.
  cart["shopper"] = envelope;
  cart["shopperUid"] = envelope.shopperUid;
  if (cart["newTransaction"]) cart["newTransaction"]["shopperUid"] = envelope.shopperUid;

  const model = request.bookingModel ?? BOOKING_MODEL.site;
  // Resolve the legs to hold. Day Use is the single slot as a quota Zone; an itinerary
  // (backcountry) is one leg per night, each with its own resourceModel; otherwise a
  // single Site. Each leg is then routed to a resource (site) or zone (quota) blocker
  // by its resourceModel — the platform rejects a site hold on a quota zone.
  const legSpecs: Array<{ resourceId: number; startDate: ISODate; endDate: ISODate; resourceModel: number }> =
    model === BOOKING_MODEL.dayUse
      ? [{ resourceId: request.resourceId, startDate: request.startDate, endDate: request.endDate, resourceModel: RESOURCE_MODEL.zone }]
      : request.itinerary && request.itinerary.length > 0
        ? request.itinerary.map((l) => ({
            resourceId: l.resourceId,
            startDate: l.startDate,
            endDate: l.endDate,
            resourceModel: l.resourceModel ?? RESOURCE_MODEL.site,
          }))
        : [{ resourceId: request.resourceId, startDate: request.startDate, endDate: request.endDate, resourceModel: RESOURCE_MODEL.site }];

  const refs: BookingRefs = {
    bookingUid: ids.bookingUid,
    cartUid,
    cartTransactionUid,
    resourceBlockerUids: [],
    resourceZoneBlockerUids: [],
  };
  const resourceBlockers: Array<Record<string, any>> = [];
  const resourceZoneBlockers: Array<Record<string, any>> = [];
  const units = partySize(request.party);
  let usedSiteUid = false;
  let usedZoneUid = false;
  for (const l of legSpecs) {
    const isZone = l.resourceModel === RESOURCE_MODEL.zone;
    // Reuse the client-minted ids for the first hold of each kind (keeps a stable,
    // testable id); mint fresh GUIDs for any further legs.
    const uid = isZone
      ? usedZoneUid
        ? randomUUID()
        : ((usedZoneUid = true), ids.resourceZoneBlockerUid)
      : usedSiteUid
        ? randomUUID()
        : ((usedSiteUid = true), ids.resourceBlockerUid);
    const leg: BlockerLeg = { uid, resourceId: l.resourceId, startDate: l.startDate, endDate: l.endDate, resourceModel: l.resourceModel };
    if (isZone) {
      const lean = model === BOOKING_MODEL.backcountry; // backcountry omits txn fields
      resourceZoneBlockers.push(buildResourceZoneBlocker(leg, request.resourceLocationId, units, refs, lean));
      refs.resourceZoneBlockerUids.push(uid);
    } else {
      resourceBlockers.push(buildResourceBlocker(leg, request.resourceLocationId, refs));
      refs.resourceBlockerUids.push(uid);
    }
  }

  cart["bookings"] = [buildBooking(request, refs, envelope, stage)];
  cart["resourceBlockers"] = resourceBlockers;
  cart["resourceZoneBlockers"] = resourceZoneBlockers;
  return { cart };
}
