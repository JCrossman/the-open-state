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
        "Prepare a Parks Canada reservation for a specific campsite and dates and " +
        "carry it all the way to the payment screen — then hand it to the citizen " +
        "to review and pay themselves. ALWAYS call this first WITHOUT confirm to " +
        "show the citizen exactly what will be booked (site, dates, party, who the " +
        "reservation is for). Only after they explicitly confirm, call again with " +
        "confirm: true — that holds the site and opens their browser at their cart " +
        "to pay. You never enter payment or pay on your own. Preparing holds " +
        "nothing and costs nothing; a reservation (and any fee) only exists once " +
        "the citizen pays. Requires connect_account first. Use site_id and " +
        "campground_id from search_sites.",
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

      // Phase 2 — the citizen confirmed. Drive the booking through the wizard's
      // commit stages (hold → details → finalize) so the server validates the same
      // progression a person clicking through would. Each stage re-commits the cart
      // with the same client-minted ids. We stop before payment and never pay.
      const ids = newBookingIds();
      for (const stage of BOOKING_STAGES) {
        const cart = buildBookingCart(request, ids, envelope, stage);
        try {
          await provider.commitCart(cart, { isCompleted: false });
        } catch (err) {
          return text(
            `I couldn't prepare the booking with Parks Canada (it failed at the ` +
              `"${stage}" step).\n${err instanceof Error ? err.message : String(err)}\n\n` +
              "Nothing was reserved and nothing was charged. The held site, if any, " +
              "releases on its own.",
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
    `- Dates: ${request.startDate} to ${request.endDate}` +
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
