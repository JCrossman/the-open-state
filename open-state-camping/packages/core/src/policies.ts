/**
 * Parks Canada reservation policies, as structured knowledge the assistant can use
 * to answer "what happens if I cancel?" honestly and to warn a citizen *before* they
 * pay — fees, deadlines, check-in times, no-show rules (Constitution Art. 7: honest;
 * Art. 2: the human decides with full information).
 *
 * Source: https://parks.canada.ca/termes-terms/reservation (the official Parks
 * Canada "Reservation policies" page), transcribed 2026-06-08. Fees and windows are
 * the platform's published values; the citizen always sees the authoritative price
 * and terms in their own session at the payment screen. Times are local to the park.
 *
 * This is reference text, not a rules engine: we never compute or charge anything.
 */

export const POLICY_SOURCE_URL = "https://parks.canada.ca/termes-terms/reservation";
export const POLICY_AS_OF = "2026-06-08";

/** The booking families a citizen reserves, each with its own policy set. */
export type PolicyFamily =
  | "frontcountry"
  | "accommodation"
  | "group"
  | "dayUse"
  | "backcountry";

export interface ReservationPolicy {
  /** Human-facing family name. */
  readonly name: string;
  /** One-line scope so the assistant can confirm it's quoting the right family. */
  readonly scope: string;
  /** Non-refundable reservation fee, online vs. by phone (CAD). */
  readonly reservationFee: { readonly online: string; readonly phone: string };
  /** When the citizen can check in / when the site is held until / when to leave. */
  readonly checkIn?: string;
  readonly heldUntil?: string;
  readonly checkOut?: string;
  /** Deadline to change or cancel for the best refund, in plain language. */
  readonly changeCancelWindow: string;
  /** What a refund looks like, by timing — ordered most- to least-generous. */
  readonly cancellation: readonly string[];
  /** What counts as a no-show and what it costs. */
  readonly noShow?: string;
  /** Anything family-specific worth stating up front. */
  readonly notes?: readonly string[];
}

/**
 * The published policies. Values are quoted from the source page; where the page
 * gives a range or "varies by activity", we say so rather than inventing a number.
 */
export const RESERVATION_POLICIES: Record<PolicyFamily, ReservationPolicy> = {
  frontcountry: {
    name: "Frontcountry camping",
    scope: "Drive-up campsites (tent, RV, serviced and unserviced sites).",
    reservationFee: { online: "$11.50", phone: "$13.50" },
    checkIn: "2:00 p.m. (local park time).",
    heldUntil: "Your site is held until 11:00 a.m. the day after your arrival date.",
    changeCancelWindow:
      "Change or cancel at least 3 full days before your arrival date for the best refund.",
    cancellation: [
      "Cancel 3+ days before arrival: refund of what you paid, minus the (non-refundable) reservation fee and a cancellation fee (same amount as the reservation fee).",
      "Cancel fewer than 3 days before arrival: as above, and you also lose the first night's fee.",
      "No-show: refund of what you paid minus the reservation fee and a penalty of up to the first 2 nights; you must claim it within 30 days.",
    ],
    noShow:
      "You're a no-show if you haven't checked in by 11:00 a.m. the day after your arrival date.",
  },
  accommodation: {
    name: "Roofed accommodations",
    scope: "oTENTik, cabin, yurt, Oasis, MicrOcube and other equipped/roofed stays.",
    reservationFee: { online: "$11.50", phone: "$13.50" },
    checkIn: "3:00 p.m. (local park time) — later than a campsite.",
    heldUntil: "Held until 11:00 a.m. the day after your arrival date.",
    changeCancelWindow:
      "Change or cancel at least 3 full days before arrival for the best refund.",
    cancellation: [
      "Cancel 3+ days before arrival: refund minus the reservation fee and an equal cancellation fee.",
      "Cancel fewer than 3 days before arrival: as above, and you also lose the first night's fee.",
      "No-show: refund minus the reservation fee and a penalty of up to the first 2 nights; claim within 30 days.",
    ],
    noShow:
      "You're a no-show if you haven't checked in by 11:00 a.m. the day after arrival.",
  },
  group: {
    name: "Group camping",
    scope: "Group tenting and group sites for organized parties.",
    reservationFee: { online: "$11.50", phone: "$13.50" },
    checkIn: "2:00 p.m. (local park time).",
    changeCancelWindow:
      "Group sites have a LONGER deadline: change or cancel at least 30 days before arrival.",
    cancellation: [
      "Cancel 30+ days before arrival: refund minus the reservation fee and a cancellation fee.",
      "Cancel fewer than 30 days before arrival: you may forfeit more, and a deposit may be non-refundable.",
    ],
    notes: [
      "A deposit may be required at booking, separate from the reservation fee.",
      "Because the change/cancel window is 30 days (not 3), decide group trips early.",
    ],
  },
  dayUse: {
    name: "Day use",
    scope: "Shuttles, parking, guided activities and other single-day experiences.",
    reservationFee: { online: "$3.50", phone: "$5.50" },
    changeCancelWindow:
      "Cancellation windows vary by activity; cancel as early as you can.",
    cancellation: [
      "Cancel 3+ days before (where the activity allows changes): refund of the activity fee, minus the reservation fee.",
      "Cancel fewer than 3 days before: you're refunded only 50% of the activity fee (the reservation fee is never refunded).",
      "No-show: you forfeit the full amount paid.",
    ],
    notes: [
      "Some day-use activities are non-changeable and non-refundable — the exact terms show at checkout.",
    ],
  },
  backcountry: {
    name: "Backcountry",
    scope:
      "Wilderness/zone permits and named routes (e.g. West Coast Trail, Chilkoot, Long Range Traverse).",
    reservationFee: { online: "$11.50", phone: "$13.50" },
    changeCancelWindow:
      "Named-route permits have a long window: change or cancel at least 21 days before your start date.",
    cancellation: [
      "A per-person backcountry use fee applies for each night.",
      "Named routes (West Coast Trail, Chilkoot, Long Range Traverse): change or cancel 21+ days before start for a refund of fees paid, minus the reservation fee.",
      "Some routes add their own fees (e.g. West Coast Trail ferry and orientation fees).",
    ],
    notes: [
      "Many backcountry areas issue the permit at the park office rather than fully online — confirm pick-up details with the park.",
      "A few areas use a random draw (e.g. Lake O'Hara: applications March 2–23, with a separate application fee).",
    ],
  },
};

/**
 * Facts that are true across every family — the ones most likely to surprise a
 * citizen at or after the payment screen, so worth stating proactively.
 */
export const CROSS_CUTTING_POLICIES: readonly string[] = [
  "The reservation fee is never refunded, even if you cancel within the free-change window.",
  "Park ENTRY is not included in a reservation — you still need a valid park pass or day admission, bought separately.",
  "All times and deadlines are in the park's own local time zone.",
  "Reselling or transferring a reservation is prohibited and voids it.",
  "Keep your reservation/booking number — you need it to check in, change, or cancel.",
  "Canada Strong Pass (June 19 – Sept 7, 2026): free park admission for everyone, plus 25% off camping fees.",
  "Questions or phone changes: the Parks Canada reservation line is 1-877-RESERVE (1-877-737-3783).",
];

/** Map a search/booking category to its policy family. */
export function policyFamilyForCategory(
  category: "campsite" | "group" | "accommodation" | "dayUse" | "backcountry",
): PolicyFamily {
  return category === "campsite" ? "frontcountry" : category;
}

/** A compact plain-language render of one family's policy (screen-reader friendly). */
export function policyText(family: PolicyFamily): string {
  const p = RESERVATION_POLICIES[family];
  const lines = [
    `${p.name} — reservation policies`,
    p.scope,
    "",
    `Reservation fee (non-refundable): ${p.reservationFee.online} online, ${p.reservationFee.phone} by phone.`,
  ];
  if (p.checkIn) lines.push(`Check-in: ${p.checkIn}`);
  if (p.heldUntil) lines.push(`Hold: ${p.heldUntil}`);
  if (p.checkOut) lines.push(`Check-out: ${p.checkOut}`);
  lines.push("", `Changing or cancelling: ${p.changeCancelWindow}`);
  for (const c of p.cancellation) lines.push(`  - ${c}`);
  if (p.noShow) lines.push(`No-show: ${p.noShow}`);
  if (p.notes && p.notes.length) {
    lines.push("", "Good to know:");
    for (const n of p.notes) lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}

/** The full policy briefing across all families plus the cross-cutting rules. */
export function allPoliciesText(): string {
  const families: PolicyFamily[] = [
    "frontcountry",
    "accommodation",
    "group",
    "dayUse",
    "backcountry",
  ];
  const blocks = families.map((f) => policyText(f));
  blocks.push(
    ["Applies to every reservation:", ...CROSS_CUTTING_POLICIES.map((c) => `  - ${c}`)].join("\n"),
  );
  blocks.push(
    `Source: Parks Canada reservation policies, ${POLICY_SOURCE_URL} (as of ${POLICY_AS_OF}). ` +
      "The authoritative fees and terms always show in your own session at the payment screen.",
  );
  return blocks.join("\n\n");
}

/**
 * The two or three most important facts to surface when *preparing* a booking of a
 * given family — the cancellation deadline and the fees-not-included reality — so the
 * citizen confirms with eyes open, without dumping the whole policy on them.
 */
export function bookingPolicyHighlights(family: PolicyFamily): string {
  const p = RESERVATION_POLICIES[family];
  const lines = [
    "Before you pay, a few Parks Canada policies to know:",
    `  - ${p.changeCancelWindow}`,
    `  - The ${p.reservationFee.online} reservation fee (online) is non-refundable.`,
    "  - Park entry isn't included — you still need a valid park pass.",
  ];
  return lines.join("\n");
}
