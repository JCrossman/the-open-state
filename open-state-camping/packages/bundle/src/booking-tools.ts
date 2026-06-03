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
  BOOKING_STAGES,
  buildBookingCart,
  newBookingIds,
  partySize,
  type BookingRequest,
  type ParksCanadaProvider,
  type PartyCounts,
  type ShopperEnvelope,
} from "@open-state/core";
import { openCheckout } from "./session/capture.js";
import { loadSession } from "./session/vault.js";

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

      const request: BookingRequest = {
        resourceId: Number(args.site_id),
        resourceLocationId: Number(args.campground_id),
        startDate: args.start_date,
        endDate: args.end_date,
        party,
      };

      const summary = bookingSummary(request, party, envelope);

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

      // Phase 2 — the citizen confirmed. First get a real, server-issued cart
      // transaction (it carries the shift/user/reference context the commit
      // requires; fabricating it is rejected with a 400), then drive the booking
      // through the wizard's commit stages (hold → details → finalize). We stop
      // before payment and never pay.
      const ids = newBookingIds();
      let base: Record<string, any>;
      try {
        base = await provider.newCartTransaction(ids.cartUid);
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

      try {
        await openCheckout();
      } catch (err) {
        return text(
          summary +
            "\n\nI prepared your cart, but couldn't open your browser " +
            `automatically (${err instanceof Error ? err.message : String(err)}). ` +
            "Open https://reservation.pc.gc.ca/cart in Chrome to review and pay.",
        );
      }

      return text(
        summary +
          "\n\nYour cart is ready. I've opened Parks Canada in your browser at your " +
          "cart — review it and enter payment there to confirm. Nothing is reserved " +
          "until you pay, and I never handle your card. The held site will release " +
          "on its own if you don't complete payment.",
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
  return [
    "Here's the booking I'll prepare:",
    `- Site: ${request.resourceId} (campground ${request.resourceLocationId})`,
    `- Dates: ${withWeekday(request.startDate)} to ${withWeekday(request.endDate)}` +
      (nights ? ` (${nights} night${nights === 1 ? "" : "s"})` : ""),
    `- Party: ${partyParts.join(", ") || "1 adult"}`,
    `- Reservation for: ${who}`,
  ].join("\n");
}

function nightsBetween(start: string, end: string): number {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Render an ISO date with its weekday, e.g. "Wed, 2026-06-17". The assistant can
 * confabulate the day of week from a bare date; spelling it out keeps the
 * confirmation grounded in the real calendar (parsed UTC to avoid TZ drift).
 */
function withWeekday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day}, ${iso}`;
}
