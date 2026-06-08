import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildBookingCart,
  buildOccupant,
  partyCapacityCounts,
  partySize,
  newBookingIds,
  type BookingIds,
  type BookingRequest,
  type ShopperEnvelope,
} from "../src/index.js";

/**
 * Replay-diff against a real authenticated booking capture (sanitized).
 *
 * This is the fee-free verification promised for the booking flow: we rebuild the
 * pre-payment cart from the same inputs the wizard had and assert it matches the
 * bytes Parks Canada actually accepted — no network, no hold, no reservation, no
 * cancellation fee. If the platform's contract drifts, this test catches it before
 * any live call.
 */
function fixture(name: string): any {
  const url = new URL(`./fixtures/booking/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/** The captured pre-payment cart (the wizard's state at the payment screen). */
const captured = fixture("commit-5-prepayment.json").cart;
const capturedBooking = captured.bookings[0];
const capturedNV = capturedBooking.newVersion;

/** Reconstruct the inputs the wizard had, from the captured cart. */
const envelope: ShopperEnvelope = captured.shopper;
const ids: BookingIds = {
  bookingUid: capturedBooking.bookingUid,
  resourceBlockerUid: captured.resourceBlockers[0].resourceBlockerUid,
};

/** A fresh copy of the server-issued cart skeleton to assemble the booking into
 *  (buildBookingCart mutates it). The captured cart carries the real
 *  newTransaction, exactly what GET /api/cart/newtransaction returns live. */
const baseCart = (): Record<string, any> => structuredClone(captured);
const request: BookingRequest = {
  resourceId: captured.resourceBlockers[0].newVersion.resourceId,
  resourceLocationId: capturedNV.resourceLocationId,
  startDate: capturedNV.startDate,
  endDate: capturedNV.endDate,
  // The capture was a single adult.
  party: { adults: 1 },
  equipmentCategoryId: capturedNV.equipmentCategoryId,
  subEquipmentCategoryId: capturedNV.subEquipmentCategoryId,
};

describe("booking cart assembly — party counts", () => {
  it("maps the four age bands to the verified capacity sub-categories", () => {
    expect(partyCapacityCounts({ adults: 2, seniors: 1, youth: 0, children: 3 })).toEqual([
      { capacityCategoryId: -32767, count: 2, subCapacityCategoryId: -32768 },
      { capacityCategoryId: -32767, count: 1, subCapacityCategoryId: -32767 },
      { capacityCategoryId: -32767, count: 0, subCapacityCategoryId: -32766 },
      { capacityCategoryId: -32767, count: 3, subCapacityCategoryId: -32765 },
    ]);
  });

  it("sums total heads across the party", () => {
    expect(partySize({ adults: 2, seniors: 1, children: 3 })).toBe(6);
  });

  it("reproduces the captured single-adult party exactly", () => {
    expect(partyCapacityCounts(request.party)).toEqual(capturedNV.bookingCapacityCategoryCounts);
  });
});

describe("booking cart assembly — occupant projection", () => {
  it("projects the citizen's real profile into the occupant the platform accepted", () => {
    expect(buildOccupant(envelope)).toEqual(capturedNV.occupant);
  });

  it("copies the address/phone shapes across unchanged (mutate, don't reconstruct)", () => {
    const occ = buildOccupant(envelope);
    expect(occ["address"]).toEqual(envelope.currentVersion["addresses"][0]);
    expect(occ["phoneNumbers"]).toEqual(envelope.currentVersion["phoneNumbers"]);
    expect(occ["copiedShopperUid"]).toBe(envelope.shopperUid);
  });
});

describe("booking cart assembly — full pre-payment cart", () => {
  const { cart } = buildBookingCart(baseCart(), request, ids, envelope);
  const nv = cart.bookings[0].newVersion;

  it("reproduces the booking newVersion the platform accepted (minus server-accrued state)", () => {
    // completedDate is null pre-payment in both; cartTransactionUid threads through.
    expect(nv.bookingCapacityCategoryCounts).toEqual(capturedNV.bookingCapacityCategoryCounts);
    expect(nv.occupant).toEqual(capturedNV.occupant);
    expect(nv.bookingMembers).toEqual(capturedNV.bookingMembers);
    expect(nv.startDate).toBe(capturedNV.startDate);
    expect(nv.endDate).toBe(capturedNV.endDate);
    expect(nv.checkInTime).toBe(capturedNV.checkInTime);
    expect(nv.checkOutTime).toBe(capturedNV.checkOutTime);
    expect(nv.rateCategoryId).toBe(capturedNV.rateCategoryId);
    expect(nv.equipmentCategoryId).toBe(capturedNV.equipmentCategoryId);
    expect(nv.subEquipmentCategoryId).toBe(capturedNV.subEquipmentCategoryId);
    expect(nv.resourceLocationId).toBe(capturedNV.resourceLocationId);
    expect(nv.resourceBlockerUids).toEqual([ids.resourceBlockerUid]);
    // Nothing is completed or paid in a pre-payment cart.
    expect(nv.completedDate).toBeNull();
    expect(nv.bookingStatus).toBe(0);
    expect(nv.deferredPayment).toBe(false);
  });

  it("ties the resource blocker to the booking and the chosen site/dates", () => {
    const blocker = cart.resourceBlockers[0];
    expect(blocker.resourceBlockerUid).toBe(ids.resourceBlockerUid);
    expect(blocker.bookingUid).toBe(ids.bookingUid);
    expect(blocker.isReservation).toBe(true);
    expect(blocker.newVersion.resourceId).toBe(request.resourceId);
    expect(blocker.newVersion.startDate).toBe(request.startDate);
    expect(blocker.newVersion.endDate).toBe(request.endDate);
  });

  it("threads the raw shopper envelope back into cart.shopper", () => {
    expect(cart.shopper).toBe(envelope);
    expect(cart.shopperUid).toBe(envelope.shopperUid);
  });

  it("carries the same top-level cart keys the platform expects", () => {
    for (const key of Object.keys(captured)) {
      expect(cart, `cart is missing key '${key}'`).toHaveProperty(key);
    }
  });
});

describe("booking cart assembly — wizard stages", () => {
  const holdNV = fixture("commit-1-hold.json").cart.bookings[0].newVersion;
  const detailsNV = fixture("commit-2-account.json").cart.bookings[0].newVersion;

  it("the hold stage matches the captured first commit (stub occupant, no times/members)", () => {
    const nv = buildBookingCart(baseCart(), request, ids, envelope, "hold").cart.bookings[0].newVersion;
    expect(nv.occupant).toEqual(holdNV.occupant);
    expect(nv.bookingMembers).toEqual([]);
    expect(nv.checkInTime).toBeNull();
    expect(nv.checkOutTime).toBeNull();
    expect(typeof nv.completedDate).toBe("string"); // a timestamp, as captured
  });

  it("the details stage sends the full occupant projection (times set, no members)", () => {
    // The captured account commit had a mid-edit, half-filled address (the citizen
    // was still typing across screens). We send the complete projection — strictly
    // more complete, and what the final commit needs anyway — not the transient form.
    const nv = buildBookingCart(baseCart(), request, ids, envelope, "details").cart.bookings[0].newVersion;
    expect(nv.occupant).toEqual(buildOccupant(envelope));
    expect(nv.occupant).not.toEqual(detailsNV.occupant); // not the half-filled capture
    expect(nv.bookingMembers).toEqual([]);
    expect(nv.checkInTime).toBe("14:00");
    expect(nv.checkOutTime).toBe("11:00");
    expect(nv.completedDate).toBeNull();
  });

  it("the finalize stage adds the booking-holder member", () => {
    const nv = buildBookingCart(baseCart(), request, ids, envelope, "finalize").cart.bookings[0].newVersion;
    expect(nv.bookingMembers).toEqual(capturedNV.bookingMembers);
  });
});

describe("booking ids", () => {
  it("mints three distinct client GUIDs (the server assigns cart + transaction ids)", () => {
    const ids = newBookingIds();
    const values = Object.values(ids);
    expect(new Set(values).size).toBe(3);
    for (const v of values) {
      expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe("booking cart assembly — variations (shake-out beyond the captured path)", () => {
  function nv(overrides: Partial<BookingRequest>) {
    const req: BookingRequest = { ...request, ...overrides };
    return buildBookingCart(baseCart(), req, ids, envelope, "finalize").cart.bookings[0].newVersion;
  }

  it("threads a multi-night stay into the booking and the hold", () => {
    const req: BookingRequest = { ...request, startDate: "2099-08-10", endDate: "2099-08-14" };
    const { cart } = buildBookingCart(baseCart(), req, ids, envelope, "finalize");
    expect(cart.bookings[0].newVersion.startDate).toBe("2099-08-10");
    expect(cart.bookings[0].newVersion.endDate).toBe("2099-08-14");
    expect(cart.resourceBlockers[0].newVersion.startDate).toBe("2099-08-10");
    expect(cart.resourceBlockers[0].newVersion.endDate).toBe("2099-08-14");
  });

  it("books the chosen equipment under the frontcountry category (RV/van, not tent)", () => {
    const v = nv({ subEquipmentCategoryId: -32765 }); // Van/Pickup
    expect(v.subEquipmentCategoryId).toBe(-32765);
    expect(v.equipmentCategoryId).toBe(-32768); // frontcountry "Equipment" category
  });

  it("defaults equipment to small tent when none is given", () => {
    expect(nv({}).subEquipmentCategoryId).toBe(-32768);
  });

  it("carries a mixed party into the four capacity counts", () => {
    const v = nv({ party: { adults: 2, seniors: 1, youth: 1, children: 2 } });
    expect(v.bookingCapacityCategoryCounts).toEqual([
      { capacityCategoryId: -32767, count: 2, subCapacityCategoryId: -32768 },
      { capacityCategoryId: -32767, count: 1, subCapacityCategoryId: -32767 },
      { capacityCategoryId: -32767, count: 1, subCapacityCategoryId: -32766 },
      { capacityCategoryId: -32767, count: 2, subCapacityCategoryId: -32765 },
    ]);
  });
});

describe("booking cart assembly — Day Use (model 1)", () => {
  // Mirrors the captured Moraine Lake / Lake Louise shuttle cart.
  const dayUseReq: BookingRequest = {
    resourceId: -2147476636, // a time-slot resource
    resourceLocationId: -2147483642,
    startDate: "2099-07-15",
    endDate: "2099-07-16",
    party: { adults: 2 },
    bookingCategoryId: 9,
    bookingModel: 1,
  };

  it("holds the slot via a zone blocker, not a resource blocker", () => {
    const { cart } = buildBookingCart(baseCart(), dayUseReq, ids, envelope, "finalize");
    expect(cart.resourceBlockers).toEqual([]);
    const zb = cart.resourceZoneBlockers[0].newVersion;
    expect(zb.resourceId).toBe(-2147476636);
    expect(zb.resourceLocationId).toBe(-2147483642);
    expect(zb.unitsBlocked).toBe(2); // one unit per head in the party
    const nv = cart.bookings[0].newVersion;
    expect(nv.resourceZoneBlockerUids).toEqual([ids.resourceZoneBlockerUid]);
    expect(nv.resourceBlockerUids).toEqual([]);
  });

  it("carries no equipment and the full-day check-in/out window, as model 1", () => {
    const { cart } = buildBookingCart(baseCart(), dayUseReq, ids, envelope, "finalize");
    const booking = cart.bookings[0];
    expect(booking.bookingModel).toBe(1);
    expect(booking.bookingCategoryId).toBe(9);
    expect(booking.newVersion.equipmentCategoryId).toBeNull();
    expect(booking.newVersion.subEquipmentCategoryId).toBeNull();
    expect(booking.newVersion.checkInTime).toBe("10:00");
    expect(booking.newVersion.checkOutTime).toBe("23:59");
  });
});

describe("booking cart assembly — Backcountry (model 5)", () => {
  // Mirrors the captured Pacific Rim - Broken Group Islands two-night itinerary.
  const bcReq: BookingRequest = {
    resourceId: -2147483547,
    resourceLocationId: -2147483598,
    startDate: "2026-06-13",
    endDate: "2026-06-15",
    party: { adults: 2 },
    bookingCategoryId: 5,
    bookingModel: 5,
    // Backcountry Campsite zones list equipment; prepare_booking resolves it from the
    // zone and passes both ids (the captured cart used -32767 / -32758).
    equipmentCategoryId: -32767,
    subEquipmentCategoryId: -32758,
    itinerary: [
      { resourceId: -2147483547, startDate: "2026-06-13", endDate: "2026-06-14" },
      { resourceId: -2147483541, startDate: "2026-06-14", endDate: "2026-06-15" },
    ],
  };

  it("turns each itinerary leg into its own resource blocker", () => {
    const { cart } = buildBookingCart(baseCart(), bcReq, ids, envelope, "finalize");
    expect(cart.resourceBlockers).toHaveLength(2);
    expect(cart.resourceBlockers.map((b: any) => b.newVersion.resourceId)).toEqual([
      -2147483547, -2147483541,
    ]);
    expect(cart.resourceBlockers.map((b: any) => b.newVersion.startDate)).toEqual([
      "2026-06-13",
      "2026-06-14",
    ]);
    const nv = cart.bookings[0].newVersion;
    expect(nv.resourceBlockerUids).toHaveLength(2);
    expect(nv.resourceBlockerUids).toEqual(cart.resourceBlockers.map((b: any) => b.resourceBlockerUid));
  });

  it("spans the whole itinerary with backcountry model, times, and equipment", () => {
    const { cart } = buildBookingCart(baseCart(), bcReq, ids, envelope, "finalize");
    const booking = cart.bookings[0];
    expect(booking.bookingModel).toBe(5);
    expect(booking.newVersion.startDate).toBe("2026-06-13");
    expect(booking.newVersion.endDate).toBe("2026-06-15"); // last leg's end
    expect(booking.newVersion.checkInTime).toBe("12:00");
    expect(booking.newVersion.checkOutTime).toBe("11:00");
    expect(booking.newVersion.equipmentCategoryId).toBe(-32767); // backcountry equipment
  });

  it("builds a quota-zone permit cart (entry point + per-night zone blockers), matching the capture", () => {
    // Backcountry Zone permit (verified vs a captured Forillon zone booking): an entry
    // point, per-night resourceZoneBlockers (resourceModel 2) with unitsBlocked = party,
    // null check-in/out, no equipment, and an extra capacity count under the zone's own
    // capacity category. A per-site blocker / 12:00 times / missing entry point were the
    // ResourceUnavailable + InvalidCart failures.
    const zoneTrip: BookingRequest = {
      ...bcReq,
      bookingCategoryId: 7,
      equipmentCategoryId: undefined,
      subEquipmentCategoryId: undefined,
      party: { adults: 1 },
      entryPointResourceId: -2147471842,
      zoneCapacityCategoryId: -32766,
      itinerary: [
        { resourceId: -2147471839, startDate: "2026-08-26", endDate: "2026-08-27", resourceModel: 2 },
        { resourceId: -2147471838, startDate: "2026-08-27", endDate: "2026-08-28", resourceModel: 2 },
      ],
    };
    const { cart } = buildBookingCart(baseCart(), zoneTrip, ids, envelope, "finalize");
    expect(cart.resourceBlockers).toEqual([]); // not site holds
    expect(cart.resourceZoneBlockers).toHaveLength(2);
    expect(cart.resourceZoneBlockers.every((b: any) => b.newVersion.unitsBlocked === 1)).toBe(true);
    // Backcountry zone blockers are lean (no blockerTransactionStatus/completedDate).
    expect(cart.resourceZoneBlockers[0].newVersion).not.toHaveProperty("blockerTransactionStatus");
    expect(cart.resourceZoneBlockers[0].newVersion).not.toHaveProperty("completedDate");
    const nv = cart.bookings[0].newVersion;
    expect(nv.resourceZoneBlockerUids).toHaveLength(2);
    expect(nv.resourceBlockerUids).toEqual([]);
    expect(nv.equipmentCategoryId).toBeNull();
    expect(nv.subEquipmentCategoryId).toBeNull();
    expect(nv.checkInTime).toBeNull();
    expect(nv.checkOutTime).toBeNull();
    expect(nv.entryPointResourceId).toBe(-2147471842);
    // Extra capacity count keyed by the zone's capacity category, count = party total.
    expect(nv.bookingCapacityCategoryCounts).toContainEqual({
      capacityCategoryId: -32766,
      subCapacityCategoryId: null,
      count: 1,
    });
  });
});

describe("booking cart assembly — uses the server transaction", () => {
  it("threads the server-issued cartTransactionUid into the booking, not a client guess", () => {
    const base = baseCart();
    const serverTxn = base["newTransaction"]["cartTransactionUid"];
    const { cart } = buildBookingCart(base, request, ids, envelope, "finalize");
    expect(cart.bookings[0].createTransactionUid).toBe(serverTxn);
    expect(cart.bookings[0].newVersion.cartTransactionUid).toBe(serverTxn);
    expect(cart.resourceBlockers[0].newVersion.cartTransactionUid).toBe(serverTxn);
    // the server's transaction context is preserved, not overwritten
    expect(cart.newTransaction.cartTransactionUid).toBe(serverTxn);
  });
});
