/**
 * Booking tool: prepare a campsite reservation and complete it up to — but never
 * past — payment.
 *
 * This is the assistive completion the project exists for: we drive the parts of
 * the reservation that are hard to do accessibly (re-finding the site, the timed
 * cart, the account/occupant/party wizard) through the platform's own API, then
 * hand the citizen their cart in their own browser to review and pay. Two-phase by
 * design (Constitution Art. 2): the first call only *prepares and describes*;
 * nothing is held or written until the citizen calls again with `confirm: true`.
 * We never enter a card or pay (Art. 2, Art. 10) — and because a reservation only
 * exists once paid, preparing it incurs no fee.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  BOOKING_CATEGORY_ID,
  BOOKING_STAGES,
  buildBookingCart,
  newBookingIds,
  partySize,
  type BookingRequest,
  type CategoryGroup,
  type ParksCanadaProvider,
  type PartyCounts,
  type ShopperEnvelope,
} from "@open-state/core";
import { openCheckout } from "./session/capture.js";
import { loadSession } from "./session/vault.js";
import { stayDatesProblem, withWeekday } from "./format.js";

type TextResult = { content: { type: "text"; text: string }[] };
const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

export function registerBookingTools(server: McpServer, provider: ParksCanadaProvider): void {
  server.registerTool(
    "prepare_booking",
    {
      title: "Prepare a campsite booking (you review and pay)",
      description:
        "Use this WHENEVER the citizen wants to book, reserve, or 'book it' for a " +
        "campsite — do NOT refuse and do NOT just hand them a website link; call " +
        "this instead. This is the safe, approved way to help them book: it does " +
        "the hard, inaccessible parts of the reservation (the timed cart, the " +
        "account/occupant/party wizard) through Parks Canada's own system and " +
        "carries it all the way to the payment screen, then opens the citizen's " +
        "own browser at their cart so they review and enter payment themselves. " +
        "You never enter a card or pay — but you DO prepare the whole booking, " +
        "which is the entire purpose of this tool, so don't tell the citizen to go " +
        "do it themselves on the website. ALWAYS call this first WITHOUT confirm to " +
        "show the citizen exactly what will be booked (site, dates, party, who the " +
        "reservation is for). Only after they explicitly confirm, call again with " +
        "confirm: true — that holds the site and opens their cart to pay. Preparing " +
        "holds nothing and costs nothing; a reservation (and any fee) only exists " +
        "once the citizen pays. Requires connect_account first (if they aren't " +
        "connected, this tool will say so — then call connect_account, don't give " +
        "up). Use site_id and campground_id from search_sites.",
      inputSchema: {
        campground_id: z.string().describe("The campground's resourceLocationId (from search)."),
        site_id: z.string().describe("The chosen campsite's id (campsiteId/resourceId from search)."),
        start_date: z.string().describe("Arrival date, YYYY-MM-DD."),
        end_date: z.string().describe("Departure date, YYYY-MM-DD."),
        adults: z.number().int().min(0).optional().describe("Adults 18-64 (default 1)."),
        seniors: z.number().int().min(0).optional().describe("Seniors 65+."),
        youth: z.number().int().min(0).optional().describe("Youth 6-17."),
        children: z.number().int().min(0).optional().describe("Children 0-5."),
        equipment_type: z
          .string()
          .optional()
          .describe(
            "The equipment for the site (e.g. 'small tent', 'van', or an id from " +
              "list_equipment_types). Use the same equipment you searched with. " +
              "Defaults to a small tent. Not needed for accommodations.",
          ),
        category: z
          .enum(["campsite", "group", "accommodation"])
          .optional()
          .describe(
            "Match what you searched: 'campsite' (default), 'group', or " +
              "'accommodation' (oTENTik, cabin, yurt).",
          ),
        confirm: z
          .boolean()
          .optional()
          .describe("Only true after the citizen has seen the summary and confirmed."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!loadSession()) {
        return text("You're not connected yet. Run connect_account to sign in first.");
      }

      const dateIssue = stayDatesProblem(args.start_date, args.end_date);
      if (dateIssue) return text(dateIssue);

      const party: PartyCounts = {
        adults: args.adults ?? 1,
        seniors: args.seniors,
        youth: args.youth,
        children: args.children,
      };
      if (partySize(party) < 1) {
        return text("A booking needs at least one person in the party.");
      }

      let envelope: ShopperEnvelope | null;
      try {
        envelope = (await provider.getShopperEnvelope()) as ShopperEnvelope | null;
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }
      if (!envelope || !envelope.currentVersion) {
        return text(
          "I couldn't read your account to prepare the booking — your session may " +
            "have expired. Run connect_account to sign in again.",
        );
      }

      // Book the equipment the citizen actually wants (the site was found open for
      // it). Resolve the word/id; a bad value is flagged, not silently defaulted.
      let subEquipmentCategoryId: number | undefined;
      try {
        const resolved = await provider.resolveEquipment(args.equipment_type ?? null);
        subEquipmentCategoryId = resolved ?? undefined;
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }

      const group: CategoryGroup = args.category ?? "campsite";
      const request: BookingRequest = {
        resourceId: Number(args.site_id),
        resourceLocationId: Number(args.campground_id),
        startDate: args.start_date,
        endDate: args.end_date,
        party,
        subEquipmentCategoryId,
        bookingCategoryId: BOOKING_CATEGORY_ID[group],
      };

      const summary = bookingSummary(request, party, envelope, args.equipment_type);

      // Phase 1 — prepare and describe only. Nothing is held or written.
      if (!args.confirm) {
        return text(
          summary +
            "\n\nThis is a preview — nothing is held or paid yet. If everything is " +
            "right, confirm and I'll hold the site and open your cart so you can " +
            "review and pay yourself. (A reservation, and any fee, only exists once " +
            "you pay.)",
        );
      }

      // Phase 2 — the citizen confirmed. Start a real, server-issued cart and
      // transaction (GET /api/cart for the server's cartUid, then
      // /api/cart/newtransaction for the shift/user/reference context the commit
      // requires — fabricating either is rejected with a 400). Then drive the
      // booking through the wizard's commit stages (hold → details → finalize).
      // We stop before payment and never pay.
      const ids = newBookingIds();
      let base: Record<string, any>;
      try {
        const fresh = await provider.getNewCart();
        base = await provider.newCartTransaction(String(fresh["cartUid"]));
      } catch (err) {
        return text(
          `I couldn't start a booking with Parks Canada.\n${
            err instanceof Error ? err.message : String(err)
          }\n\nNothing was reserved and nothing was charged.`,
        );
      }
      for (const stage of BOOKING_STAGES) {
        const cart = buildBookingCart(base, request, ids, envelope, stage);
        try {
          await provider.commitCart(cart, { isCompleted: false });
        } catch (err) {
          return text(
            `I couldn't prepare the booking with Parks Canada (it failed at the ` +
              `"${stage}" step). Nothing was reserved and nothing was charged; any ` +
              `held site releases on its own.\n\n` +
              `Parks Canada's exact response (please share this verbatim so it can ` +
              `be fixed):\n${err instanceof Error ? err.message : String(err)}\n\n` +
              `The cart I sent at the "${stage}" step (your personal details ` +
              `masked):\n${maskedCart(cart)}`,
          );
        }
      }

      const cartUid = String(base["cartUid"]);
      const cartTransactionUid = String(base["newTransaction"]?.["cartTransactionUid"] ?? "");

      // Confirm the booking actually landed in the cart server-side (separates a
      // commit that didn't persist from a browser hand-off that showed the wrong cart).
      let bookingCount = -1;
      try {
        const saved = await provider.getCart(cartUid, cartTransactionUid);
        const bookings = saved?.["bookings"];
        if (Array.isArray(bookings)) bookingCount = bookings.length;
      } catch {
        /* verification is best-effort */
      }

      try {
        await openCheckout({ cartUid, cartTransactionUid });
      } catch (err) {
        return text(
          summary +
            "\n\nI prepared your cart, but couldn't open your browser " +
            `automatically (${err instanceof Error ? err.message : String(err)}). ` +
            "Open https://reservation.pc.gc.ca/cart in Chrome to review and pay.",
        );
      }

      if (bookingCount === 0) {
        return text(
          summary +
            "\n\nI sent the booking to Parks Canada without an error, but when I read " +
            "your cart back it was empty — so it didn't actually hold. Nothing was " +
            "reserved or charged. This is a bug on my side; please let me know so I " +
            `can fix it. (cart ${cartUid})`,
        );
      }

      return text(
        summary +
          "\n\nYour cart is ready" +
          (bookingCount > 0 ? " (I confirmed the site is held in your cart)" : "") +
          ". I've opened Parks Canada in your browser at your cart — review it and " +
          "enter payment there to confirm. Nothing is reserved until you pay, and I " +
          "never handle your card. The held site will release on its own if you " +
          "don't complete payment.",
      );
    },
  );
}

/**
 * Masked dump of the booking cart for diagnostics: keeps the structure (which is
 * what 400s are about) but redacts personal values. Mirrors the masked-payload
 * approach that cracked the profile-update 400s.
 */
function maskedCart(cart: { cart: Record<string, any> }): string {
  const PII = new Set([
    "firstName", "lastName", "email", "primaryPhoneNumber", "secondaryPhoneNumber",
    "streetAddress", "city", "contactName", "phoneNumber", "region", "regionCode",
    "unit", "postalCode",
  ]);
  const mask = (v: any, k?: string): any => {
    if (k && PII.has(k)) {
      return v == null ? v : typeof v === "string" ? `<set:${v.length}chars>` : "<masked>";
    }
    if (Array.isArray(v)) return v.map((x) => mask(x));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, mask(vv, kk)]));
    }
    return v;
  };
  return JSON.stringify(mask(cart), null, 2);
}

/** Plain-language summary of what will be booked. */
function bookingSummary(
  request: BookingRequest,
  party: PartyCounts,
  envelope: ShopperEnvelope,
  equipmentLabel?: string,
): string {
  const p = envelope.currentVersion;
  const who = [p["firstName"], p["lastName"]].filter(Boolean).join(" ") || "you";
  const nights = nightsBetween(request.startDate, request.endDate);
  const partyParts = [
    party.adults ? `${party.adults} adult${party.adults === 1 ? "" : "s"}` : "",
    party.seniors ? `${party.seniors} senior${party.seniors === 1 ? "" : "s"}` : "",
    party.youth ? `${party.youth} youth` : "",
    party.children ? `${party.children} child${party.children === 1 ? "" : "ren"}` : "",
  ].filter(Boolean);
  const lines = [
    "Here's the booking I'll prepare:",
    `- Site: ${request.resourceId} (campground ${request.resourceLocationId})`,
    `- Dates: ${withWeekday(request.startDate)} to ${withWeekday(request.endDate)}` +
      (nights ? ` (${nights} night${nights === 1 ? "" : "s"})` : ""),
    `- Party: ${partyParts.join(", ") || "1 adult"}`,
  ];
  if (equipmentLabel) lines.push(`- Equipment: ${equipmentLabel}`);
  lines.push(`- Reservation for: ${who}`);
  return lines.join("\n");
}

function nightsBetween(start: string, end: string): number {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
