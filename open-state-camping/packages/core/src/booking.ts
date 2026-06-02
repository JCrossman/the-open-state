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
  cartTransactionUid: string;
  resourceBlockerUid: string;
}

/** Mint a fresh set of cart GUIDs. */
export function newBookingIds(): BookingIds {
  return {
    cartUid: randomUUID(),
    bookingUid: randomUUID(),
    cartTransactionUid: randomUUID(),
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
 * Assemble the fully-populated, pre-payment `cart` object for `POST
 * /api/cart/commit`. This is the state the wizard reaches at the payment screen —
 * everything is filled in, nothing is paid. Committing it holds the site and
 * advances to payment; the citizen pays in their browser.
 */
export function buildBookingCart(
  request: BookingRequest,
  ids: BookingIds,
  envelope: ShopperEnvelope,
): { cart: Record<string, any> } {
  const equipmentCategoryId = request.equipmentCategoryId ?? NON_GROUP_EQUIPMENT;
  const subEquipmentCategoryId = request.subEquipmentCategoryId ?? NON_GROUP_EQUIPMENT;

  const resourceBlocker = {
    blockerType: 0,
    cartUid: ids.cartUid,
    resourceBlockerUid: ids.resourceBlockerUid,
    bookingUid: ids.bookingUid,
    groupHoldUid: "",
    isReservation: true,
    newVersion: {
      creationDate: new Date().toISOString(),
      cartTransactionUid: ids.cartTransactionUid,
      startDate: request.startDate,
      endDate: request.endDate,
      resourceId: request.resourceId,
      resourceLocationId: request.resourceLocationId,
      status: 0,
    },
  };

  const bookingNewVersion: Record<string, any> = {
    cartTransactionUid: ids.cartTransactionUid,
    bookingMembers: [bookingHolderMember(envelope)],
    bookingVehicles: [],
    bookingBoats: [],
    bookingCapacityCategoryCounts: partyCapacityCounts(request.party),
    rateCategoryId: request.rateCategoryId ?? DEFAULT_RATE_CATEGORY_ID,
    resourceBlockerUids: [ids.resourceBlockerUid],
    resourceNonSpecificBlockerUids: [],
    resourceZoneBlockerUids: [],
    resourceZoneEntryBlockerUids: [],
    startDate: request.startDate,
    endDate: request.endDate,
    releasePersonalInformation: false,
    equipmentCategoryId,
    subEquipmentCategoryId,
    occupant: buildOccupant(envelope),
    requiresCheckout: false,
    bookingStatus: 0,
    completedDate: null,
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
    checkInTime: request.checkInTime ?? DEFAULT_CHECK_IN_TIME,
    checkOutTime: request.checkOutTime ?? DEFAULT_CHECK_OUT_TIME,
    deferredPayment: false,
  };

  const booking = {
    bookingUid: ids.bookingUid,
    cartUid: ids.cartUid,
    bookingCategoryId: 0,
    bookingModel: 0,
    newVersion: bookingNewVersion,
    createTransactionUid: ids.cartTransactionUid,
    currentVersion: null,
    history: [],
    drafts: [],
    referenceNumberPostfix: "",
  };

  const cart: Record<string, any> = {
    cartUid: ids.cartUid,
    createTransactionUid: ids.cartTransactionUid,
    shopperUid: envelope.shopperUid,
    groupUid: null,
    referenceNumberPrefix: "",
    referenceNumberSuffix: "",
    newTransaction: {
      cartTransactionUid: ids.cartTransactionUid,
      cartUid: "00000000-0000-0000-0000-000000000000",
      shopperUid: envelope.shopperUid,
      status: 1,
      transactionBookings: [],
      transactionSales: [],
      transactionShipments: [],
    },
    transactionDrafts: [],
    transactionHistory: [],
    giftCards: [],
    sales: [],
    bookings: [booking],
    shipments: [],
    groupHold: null,
    paymentGroups: [],
    gatewayPaymentSessions: [],
    lineItems: [],
    resourceBlockers: [resourceBlocker],
    resourceNonSpecificBlockers: [],
    resourceZoneBlockers: [],
    resourceZoneEntryBlockers: [],
    waitlistApplications: [],
    shopper: envelope,
  };

  return { cart };
}
