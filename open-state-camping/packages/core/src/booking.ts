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
}

/**
 * The client-generated GUIDs that tie a cart together. The Angular app mints these
 * locally before the first commit (the first commit *is* the hold); we do the same.
 */
export interface BookingIds {
  cartUid: string;
  bookingUid: string;
  resourceBlockerUid: string;
}

/**
 * Mint the client-generated cart GUIDs. `cartUid` is used to start the server
 * transaction (GET /api/cart/newtransaction); the server assigns the
 * `cartTransactionUid`, so we don't generate that one.
 */
export function newBookingIds(): BookingIds {
  return {
    cartUid: randomUUID(),
    bookingUid: randomUUID(),
    resourceBlockerUid: randomUUID(),
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

/** Identify the booking within a specific server-issued transaction. */
interface BookingRefs {
  bookingUid: string;
  cartUid: string;
  cartTransactionUid: string;
  resourceBlockerUid: string;
}

/** The site hold (resource blocker) for the chosen site and dates. */
export function buildResourceBlocker(
  request: BookingRequest,
  refs: BookingRefs,
): Record<string, any> {
  return {
    blockerType: 0,
    cartUid: refs.cartUid,
    resourceBlockerUid: refs.resourceBlockerUid,
    bookingUid: refs.bookingUid,
    groupHoldUid: "",
    isReservation: true,
    newVersion: {
      creationDate: new Date().toISOString(),
      cartTransactionUid: refs.cartTransactionUid,
      startDate: request.startDate,
      endDate: request.endDate,
      resourceId: request.resourceId,
      resourceLocationId: request.resourceLocationId,
      status: 0,
    },
  };
}

/** The booking object (one site, one stay) added to the cart's `bookings`. */
export function buildBooking(
  request: BookingRequest,
  refs: BookingRefs,
  envelope: ShopperEnvelope,
  stage: BookingStage,
): Record<string, any> {
  const equipmentCategoryId = request.equipmentCategoryId ?? NON_GROUP_EQUIPMENT;
  const subEquipmentCategoryId = request.subEquipmentCategoryId ?? NON_GROUP_EQUIPMENT;
  const isHold = stage === "hold";
  const newVersion: Record<string, any> = {
    cartTransactionUid: refs.cartTransactionUid,
    bookingMembers: stage === "finalize" ? [bookingHolderMember(envelope)] : [],
    bookingVehicles: [],
    bookingBoats: [],
    bookingCapacityCategoryCounts: partyCapacityCounts(request.party),
    rateCategoryId: request.rateCategoryId ?? DEFAULT_RATE_CATEGORY_ID,
    resourceBlockerUids: [refs.resourceBlockerUid],
    resourceNonSpecificBlockerUids: [],
    resourceZoneBlockerUids: [],
    resourceZoneEntryBlockerUids: [],
    startDate: request.startDate,
    endDate: request.endDate,
    releasePersonalInformation: false,
    equipmentCategoryId,
    subEquipmentCategoryId,
    occupant: isHold ? minimalOccupant(envelope) : buildOccupant(envelope),
    requiresCheckout: false,
    bookingStatus: 0,
    completedDate: isHold ? new Date().toISOString() : null,
    arrivalComment: "",
    entryPointResourceId: null,
    exitPointResourceId: null,
    bookingSurcharges: [],
    consentToRelease: false,
    equipmentDescription: "",
    groupHoldUid: null,
    organizationName: "",
    passExpiryDate: null,
    passNumber: "",
    resourceLocationId: request.resourceLocationId,
    checkInTime: isHold ? null : (request.checkInTime ?? DEFAULT_CHECK_IN_TIME),
    checkOutTime: isHold ? null : (request.checkOutTime ?? DEFAULT_CHECK_OUT_TIME),
    deferredPayment: false,
  };
  return {
    bookingUid: refs.bookingUid,
    cartUid: refs.cartUid,
    bookingCategoryId: 0,
    bookingModel: 0,
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
  const cartUid = (cart["cartUid"] as string) ?? ids.cartUid;
  const cartTransactionUid =
    (cart["newTransaction"]?.["cartTransactionUid"] as string) ??
    (cart["createTransactionUid"] as string);

  // Attach the shopper, mirroring the SPA's populateShopperOnCart.
  cart["shopper"] = envelope;
  cart["shopperUid"] = envelope.shopperUid;
  if (cart["newTransaction"]) cart["newTransaction"]["shopperUid"] = envelope.shopperUid;

  const refs: BookingRefs = {
    bookingUid: ids.bookingUid,
    cartUid,
    cartTransactionUid,
    resourceBlockerUid: ids.resourceBlockerUid,
  };
  cart["bookings"] = [buildBooking(request, refs, envelope, stage)];
  cart["resourceBlockers"] = [buildResourceBlocker(request, refs)];
  return { cart };
}
