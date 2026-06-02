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
  cartUid: captured.cartUid,
  bookingUid: capturedBooking.bookingUid,
  cartTransactionUid: capturedBooking.createTransactionUid,
  resourceBlockerUid: captured.resourceBlockers[0].resourceBlockerUid,
};
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
  const { cart } = buildBookingCart(request, ids, envelope);
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
    const nv = buildBookingCart(request, ids, envelope, "hold").cart.bookings[0].newVersion;
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
    const nv = buildBookingCart(request, ids, envelope, "details").cart.bookings[0].newVersion;
    expect(nv.occupant).toEqual(buildOccupant(envelope));
    expect(nv.occupant).not.toEqual(detailsNV.occupant); // not the half-filled capture
    expect(nv.bookingMembers).toEqual([]);
    expect(nv.checkInTime).toBe("14:00");
    expect(nv.checkOutTime).toBe("11:00");
    expect(nv.completedDate).toBeNull();
  });

  it("the finalize stage adds the booking-holder member", () => {
    const nv = buildBookingCart(request, ids, envelope, "finalize").cart.bookings[0].newVersion;
    expect(nv.bookingMembers).toEqual(capturedNV.bookingMembers);
  });
});

describe("booking ids", () => {
  it("mints four distinct GUIDs", () => {
    const ids = newBookingIds();
    const values = Object.values(ids);
    expect(new Set(values).size).toBe(4);
    for (const v of values) {
      expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
