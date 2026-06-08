import { describe, expect, it } from "vitest";
import {
  RESERVATION_POLICIES,
  CROSS_CUTTING_POLICIES,
  policyFamilyForCategory,
  policyText,
  allPoliciesText,
  bookingPolicyHighlights,
  type PolicyFamily,
} from "../src/policies.js";

const FAMILIES: PolicyFamily[] = [
  "frontcountry",
  "accommodation",
  "group",
  "dayUse",
  "backcountry",
];

describe("reservation policies", () => {
  it("has a complete, well-formed policy for every family", () => {
    for (const f of FAMILIES) {
      const p = RESERVATION_POLICIES[f];
      expect(p.name).toBeTruthy();
      expect(p.scope).toBeTruthy();
      expect(p.reservationFee.online).toMatch(/^\$\d/);
      expect(p.reservationFee.phone).toMatch(/^\$\d/);
      expect(p.cancellation.length).toBeGreaterThan(0);
      expect(p.changeCancelWindow).toBeTruthy();
    }
  });

  it("maps a search category to the right policy family", () => {
    expect(policyFamilyForCategory("campsite")).toBe("frontcountry");
    expect(policyFamilyForCategory("group")).toBe("group");
    expect(policyFamilyForCategory("accommodation")).toBe("accommodation");
    expect(policyFamilyForCategory("dayUse")).toBe("dayUse");
    expect(policyFamilyForCategory("backcountry")).toBe("backcountry");
  });

  it("renders the key facts for each family", () => {
    const fc = policyText("frontcountry");
    expect(fc).toContain("$11.50");
    expect(fc).toContain("2:00 p.m.");
    expect(fc).toMatch(/3 full days/);

    // Group's deadline is the longer 30-day window — the most surprising fact.
    expect(policyText("group")).toMatch(/30 days/);
    // Accommodation check-in is later (3 p.m.).
    expect(policyText("accommodation")).toContain("3:00 p.m.");
    // Day use has the cheaper reservation fee.
    expect(policyText("dayUse")).toContain("$3.50");
    // Backcountry named routes use a 21-day window.
    expect(policyText("backcountry")).toMatch(/21/);
  });

  it("full briefing covers all families and the cross-cutting rules", () => {
    const all = allPoliciesText();
    for (const f of FAMILIES) expect(all).toContain(RESERVATION_POLICIES[f].name);
    // Park entry not included is a cross-cutting fact that must appear.
    expect(all.toLowerCase()).toMatch(/entry is not included/);
    expect(all).toContain("Canada Strong Pass");
    expect(CROSS_CUTTING_POLICIES.length).toBeGreaterThan(3);
  });

  it("booking highlights are short and lead with the deadline + fees", () => {
    const h = bookingPolicyHighlights("frontcountry");
    expect(h).toMatch(/before you pay/i);
    expect(h).toMatch(/non-refundable/);
    expect(h).toMatch(/park pass/);
    // Keep it brief — a few lines, not the whole policy.
    expect(h.split("\n").length).toBeLessThanOrEqual(5);
  });
});
