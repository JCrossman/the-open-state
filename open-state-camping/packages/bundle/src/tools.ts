/**
 * MCP read tools for the local bundle: anonymous Parks Canada search,
 * availability, site details, and a prepared booking link (fallback). These run
 * on the citizen's own machine — their own IP, not a single hosted address — so
 * Parks Canada sees ordinary, distributed traffic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ParksCanadaProvider, windowNights } from "@open-state/core";
import type { BundleConfig } from "./config.js";
import * as fmt from "./format.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-17 (YYYY-MM-DD).");

/** Which kind of frontcountry stay to search. */
const categoryParam = z
  .enum(["campsite", "group", "accommodation"])
  .optional()
  .describe(
    "What to search: 'campsite' (regular sites, default), 'group' (group " +
      "campsites), or 'accommodation' (roofed/equipped — oTENTik, cabin, yurt).",
  );

type TextResult = { content: { type: "text"; text: string }[] };
const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

function stay(start: string, end: string): string {
  // Include the weekday (computed, not guessed) so the assistant's date sense is
  // grounded by the tool result rather than its own unreliable weekday arithmetic.
  return `${fmt.withWeekday(start)} to ${fmt.withWeekday(end)}`;
}

/** Longest stay we treat as an exact "every night" search; longer ⇒ likely a range. */
const MAX_EXACT_STAY_NIGHTS = 14;

/**
 * Guard the misleading "fully booked" case: an exact-stay search (no `nights`)
 * over a long span almost never matches, because a site must be open every
 * single night. Rather than report a false "no availability", ask how long a
 * stay they want — then the range is searched for an opening (Constitution
 * Art. 7.1: flag, don't guess). Returns a clarification, or null if fine.
 */
export function flexibleRangeHint(
  start: string,
  end: string,
  nights?: number | null,
): string | null {
  if (nights != null) return null;
  const span = windowNights(start, end).length;
  if (span <= MAX_EXACT_STAY_NIGHTS) return null;
  return (
    `That search is for a single stay covering every night from ${start} to ${end} ` +
    `— ${span} nights — so almost nothing will show as available (few sites are open ` +
    `that whole stretch). If you want a flexible stay, tell me how many nights you'd ` +
    `like (for example 2 or 3) and I'll find openings anywhere in that range. If you ` +
    `really do want all ${span} nights, let me know and I'll search that exact stay.`
  );
}

export function registerTools(
  server: McpServer,
  provider: ParksCanadaProvider,
  config: BundleConfig,
): void {
  const recArea = config.recreationAreaId;

  server.registerTool(
    "resolve_dates",
    {
      title: "Work out exact calendar dates",
      description:
        "Turn a citizen's dates into exact calendar dates, with the correct day " +
        "of the week, before you search or book. ALWAYS use this when a citizen " +
        "gives a date — especially a bare one like 'June 16' or 'next Friday' — " +
        "and do NOT work out the year or the weekday yourself (that is error-prone " +
        "for you). Give the month and day; leave year off to get the next upcoming " +
        "occurrence (this runs on the citizen's machine, so it knows today's real " +
        "date). Add nights for a stay to get the departure date too. Use the " +
        "start_date and end_date it returns verbatim in search_sites / " +
        "search_park_availability / prepare_booking.",
      inputSchema: {
        month: z.number().int().min(1).max(12).describe("Arrival month, 1-12."),
        day: z.number().int().min(1).max(31).describe("Arrival day of month, 1-31."),
        year: z
          .number()
          .int()
          .optional()
          .describe("Arrival year. Leave off for the next upcoming occurrence."),
        nights: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Number of nights, to also compute the departure date."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => text(fmt.resolveDates(args)),
  );

  server.registerTool(
    "search_parks",
    {
      title: "Find a Parks Canada campground",
      description:
        "Find Parks Canada campgrounds by a plain-language place name (for " +
        'example "Banff" or "Jasper"). Use this first; it returns matching ' +
        "campgrounds and their ids, which the other tools need. Canada only.",
      inputSchema: { query: z.string(), country: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, country }) => {
      try {
        const areas = await provider.searchParks(query, country ?? "CA");
        return text(fmt.formatSearchParks(query, areas));
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "list_equipment_types",
    {
      title: "List equipment types",
      description:
        "List the equipment types you can filter sites by (tent, RV, and so " +
        "on). Pass a returned equipment id as equipment_type when you search.",
      inputSchema: { recreation_area_id: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ recreation_area_id }) => {
      try {
        const types = await provider.listEquipmentTypes(recreation_area_id ?? recArea);
        return text(fmt.formatEquipmentTypes(types));
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "search_sites",
    {
      title: "Search for open campsites",
      description:
        "Find open campsites in a campground for a stay, accessibility first. " +
        "Use after search_parks gives you a campground id. start_date and " +
        "end_date are an EXACT stay — a site must be open every night between " +
        "them. For a flexible search across a wide range (e.g. \"anything in " +
        "June\"), also pass nights = how many nights you want, and openings " +
        "anywhere in the range are returned. Set accessible_only for sites " +
        "Parks Canada marks accessible. equipment_type takes a word like " +
        '"tent" or "RV", or an equipment id from list_equipment_types. ' +
        "The result states each date's weekday (correctly computed) — use that " +
        "and don't work out days of the week yourself, as that is error-prone.",
      inputSchema: {
        campground_id: z.string(),
        start_date: isoDate,
        end_date: isoDate,
        party_size: z.number().int().positive(),
        recreation_area_id: z.string().optional(),
        equipment_type: z.string().optional(),
        accessible_only: z.boolean().optional(),
        nights: z.number().int().positive().optional(),
        weekends_only: z.boolean().optional(),
        category: categoryParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const dateIssue = fmt.stayDatesProblem(args.start_date, args.end_date);
        if (dateIssue) return text(dateIssue);
        const hint = flexibleRangeHint(args.start_date, args.end_date, args.nights ?? null);
        if (hint) return text(hint);
        const sites = await provider.searchSites({
          recreationAreaId: args.recreation_area_id ?? recArea,
          campgroundId: args.campground_id,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
          equipmentType: args.equipment_type,
          accessibleOnly: args.accessible_only ?? false,
          nights: args.nights ?? null,
          weekendsOnly: args.weekends_only ?? false,
          category: args.category,
        });
        // On an empty result, name what the campground does offer so the citizen
        // can tell "none free that week" from "this park has none of those".
        const offers =
          sites.length === 0
            ? await provider.campgroundOfferings(args.campground_id)
            : undefined;
        return text(
          fmt.formatSearchSites(sites, {
            stay: stay(args.start_date, args.end_date),
            partySize: args.party_size,
            accessibleOnly: args.accessible_only ?? false,
            category: args.category,
            offers,
          }),
        );
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "search_park_availability",
    {
      title: "Search a whole park for availability",
      description:
        'Check every campground in a park at once ("anything open in ' +
        'Banff?") and return one consolidated list. start_date/end_date are an ' +
        "EXACT stay (open every night); for a flexible search over a wide range, " +
        "also pass nights = desired stay length and openings anywhere in the " +
        "range are returned. Then use search_sites on a campground that has " +
        "openings. equipment_type takes a word or an id.",
      inputSchema: {
        query: z.string(),
        start_date: isoDate,
        end_date: isoDate,
        party_size: z.number().int().positive(),
        equipment_type: z.string().optional(),
        accessible_only: z.boolean().optional(),
        nights: z.number().int().positive().optional(),
        weekends_only: z.boolean().optional(),
        category: categoryParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const dateIssue = fmt.stayDatesProblem(args.start_date, args.end_date);
        if (dateIssue) return text(dateIssue);
        const hint = flexibleRangeHint(args.start_date, args.end_date, args.nights ?? null);
        if (hint) return text(hint);
        const results = await provider.searchParkAvailability({
          query: args.query,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
          equipmentType: args.equipment_type,
          accessibleOnly: args.accessible_only ?? false,
          nights: args.nights ?? null,
          weekendsOnly: args.weekends_only ?? false,
          category: args.category,
        });
        return text(
          fmt.formatParkAvailability(args.query, results, {
            stay: stay(args.start_date, args.end_date),
            partySize: args.party_size,
            accessibleOnly: args.accessible_only ?? false,
          }),
        );
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "search_day_use",
    {
      title: "Search Day Use passes (shuttles, parking, guided events)",
      description:
        "Day Use = timed passes booked by the day (not overnight sites): shuttles " +
        "(Moraine Lake, Lake O'Hara), parking, ferries, guided events, fishing. " +
        "Call with NO query (or just a place) to LIST the available Day Use products. " +
        "Call with a product/place in `query` (e.g. 'Moraine Lake shuttle', 'parking') " +
        "PLUS date(s) and party size to get the open time slots with spots remaining.",
      inputSchema: {
        query: z.string().optional(),
        start_date: isoDate.optional(),
        end_date: isoDate.optional(),
        party_size: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        // Browse mode: no dates (or no query) → list the products, mirroring the tab.
        if (!args.query || !args.start_date || !args.end_date) {
          const products = await provider.listDayUseProducts(args.query);
          return text(fmt.formatDayUseProducts(products, args.query));
        }
        const dateIssue = fmt.dayUseDatesProblem(args.start_date, args.end_date);
        if (dateIssue) return text(dateIssue);
        const slots = await provider.searchDayUse({
          query: args.query,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
        });
        // No product matched the query → show the catalog so the citizen can pick.
        if (slots.length === 0 && (await provider.listDayUseProducts(args.query)).length === 0) {
          return text(fmt.formatDayUseProducts(await provider.listDayUseProducts(), args.query));
        }
        return text(
          fmt.formatDayUse(args.query, slots, {
            stay: stay(args.start_date, args.end_date),
            partySize: args.party_size ?? 1,
          }),
        );
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "search_backcountry",
    {
      title: "Search backcountry zones (wilderness permits)",
      description:
        "Backcountry = multi-night wilderness trips, booked one zone per night. " +
        "Call with NO query to LIST the backcountry areas. Call with an area/place in " +
        "`query` PLUS dates and party size to see which zones have room each night " +
        "(with accessibility surfaced). A trip is then composed one zone per night. " +
        "start_date/end_date span the nights; pass accessible_only to keep only " +
        "accessible zones.",
      inputSchema: {
        query: z.string().optional(),
        start_date: isoDate.optional(),
        end_date: isoDate.optional(),
        party_size: z.number().int().positive().optional(),
        accessible_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        if (!args.query || !args.start_date || !args.end_date) {
          const products = await provider.listBackcountryProducts(args.query);
          return text(fmt.formatBackcountryProducts(products, args.query));
        }
        const dateIssue = fmt.stayDatesProblem(args.start_date, args.end_date);
        if (dateIssue) return text(dateIssue);
        const zones = await provider.searchBackcountry({
          query: args.query,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
          accessibleOnly: args.accessible_only ?? false,
        });
        if (zones.length === 0 && (await provider.listBackcountryProducts(args.query)).length === 0) {
          return text(fmt.formatBackcountryProducts(await provider.listBackcountryProducts(), args.query));
        }
        return text(
          fmt.formatBackcountry(args.query, zones, {
            stay: stay(args.start_date, args.end_date),
            partySize: args.party_size ?? 1,
            accessibleOnly: args.accessible_only ?? false,
          }),
        );
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "get_site_details",
    {
      title: "Get campsite details",
      description:
        "Get plain-language detail about one campsite, including accessibility. " +
        "The site's photos are shown inline in the conversation by default (so the " +
        "citizen sees them without hunting for a side panel). Pass " +
        "include_photos: false only if they explicitly don't want photos.",
      inputSchema: {
        campground_id: z.string(),
        campsite_id: z.string(),
        recreation_area_id: z.string().optional(),
        include_photos: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const details = await provider.siteDetails({
          recreationAreaId: args.recreation_area_id ?? recArea,
          campgroundId: args.campground_id,
          campsiteId: args.campsite_id,
        });
        const siteLabel = details.siteName ? `Site ${details.siteName}` : "This site";
        const siteSlug = (details.siteName || "site").replace(/[^A-Za-z0-9]+/g, "-");
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
          | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }
        > = [{ type: "text", text: fmt.formatSiteDetails(details) }];

        // Photos: return the image blocks (so the assistant can see/describe them,
        // and they'll render inline once claude.ai supports it), AND a clickable
        // link per photo in the text — because claude.ai does not yet render tool
        // image blocks inline, the link is the citizen's in-flow way to open one.
        if (args.include_photos === false) {
          /* photos suppressed by request */
        } else if (details.photos.length === 0) {
          // Many campgrounds (e.g. Jasper's Whistlers) have no per-site photos.
          // Say so plainly so it doesn't read as a malfunction.
          content.push({
            type: "text",
            text:
              "Parks Canada doesn't have any photos for this site. " +
              "(Photo coverage varies by campground — some sites have none.)",
          });
        } else {
          const photos = await fetchPhotos(provider, details.photos, 3);
          if (photos.length > 0) {
            // Return each photo as a NAMED resource (not a bare image block), so
            // claude.ai shows a meaningful caption ("Site-816-photo-1.jpg") in the
            // Content panel instead of a random GUID. The blob is inline data, so
            // there's no remote fetch / browser-opening tile.
            photos.forEach(({ image }, i) => {
              content.push({
                type: "resource",
                resource: {
                  uri: `openstate://photos/Site-${siteSlug}-photo-${i + 1}.jpg`,
                  mimeType: image.mimeType,
                  blob: image.data,
                },
              });
            });
            content.push({
              type: "text",
              text:
                `${photos.length} photo(s) of ${siteLabel.toLowerCase()} are attached ` +
                "(they appear in the citizen's Content panel). Describe what they " +
                "show — how exposed, treed, level, or private the site looks — so the " +
                "citizen gets the picture without opening anything. Do NOT paste the " +
                "image links or markdown into your reply.",
            });
          } else {
            // Photos exist but couldn't be fetched — note it; don't push raw links.
            content.push({
              type: "text",
              text: "This site has photos, but I couldn't load them just now.",
            });
          }
        }
        return { content };
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );

  server.registerTool(
    "prepare_booking_url",
    {
      title: "Prepare a booking link (fallback only)",
      description:
        "FALLBACK ONLY — do not use this for a normal booking. To book or reserve " +
        "a campsite, use the prepare_booking tool instead: it completes the " +
        "reservation up to the payment screen for the citizen (they only enter " +
        "their card), which is the whole point of this tool. Only use " +
        "prepare_booking_url if prepare_booking cannot be used — for example the " +
        "citizen refuses to connect their account — because handing someone a link " +
        "back to the inaccessible website is exactly the barrier this tool exists " +
        "to remove. equipment_type is required: pass the matching id from " +
        "list_equipment_types. This tool never books or pays.",
      inputSchema: {
        campground_id: z.string(),
        campsite_id: z.string(),
        start_date: isoDate,
        end_date: isoDate,
        party_size: z.number().int().positive(),
        recreation_area_id: z.string().optional(),
        equipment_type: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const area = args.recreation_area_id ?? recArea;
      try {
        const dateIssue = fmt.stayDatesProblem(args.start_date, args.end_date);
        if (dateIssue) return text(dateIssue);
        if (args.equipment_type == null) {
          return text(await equipmentPrompt(provider, area, "missing"));
        }
        const valid = new Map(
          (await provider.listEquipmentTypes(area)).map((e) => [e.equipmentId, e.name]),
        );
        if (!valid.has(String(args.equipment_type))) {
          return text(await equipmentPrompt(provider, area, "invalid"));
        }
        const url = await provider.bookingUrl({
          campgroundId: args.campground_id,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
          equipmentType: args.equipment_type,
        });
        return text(
          `Here is your prepared Parks Canada booking link for a ` +
            `${valid.get(String(args.equipment_type))}. Open it in your browser, ` +
            "sign in to your own account, choose your exact site, and confirm and " +
            "pay yourself. This tool never books or pays on your behalf.\n\n" +
            url,
        );
      } catch (e) {
        return text(fmt.problem(e));
      }
    },
  );
}

async function equipmentPrompt(
  provider: ParksCanadaProvider,
  recreationAreaId: string,
  reason: "missing" | "invalid",
): Promise<string> {
  const lead =
    reason === "missing"
      ? "Before I can prepare a booking link, I need to know what you are camping " +
        "with - Parks Canada's booking page requires it."
      : "That equipment type is not one Parks Canada offers for this area. " +
        "Please choose one of these:";
  const types = await provider.listEquipmentTypes(recreationAreaId);
  const lines = [lead, ""];
  for (const t of types) lines.push(`- ${t.name} (equipment id: ${t.equipmentId})`);
  lines.push("", "Tell me which one fits, and I will prepare your booking link.");
  return lines.join("\n");
}

type ImageBlock = { type: "image"; data: string; mimeType: string };

async function fetchPhotos(
  provider: ParksCanadaProvider,
  photos: string[],
  cap: number,
): Promise<{ url: string; image: ImageBlock }[]> {
  const out: { url: string; image: ImageBlock }[] = [];
  for (const url of photos.slice(0, cap)) {
    const img = await provider.fetchPhoto(url);
    if (img) {
      out.push({
        url,
        image: {
          type: "image",
          data: Buffer.from(img.bytes).toString("base64"),
          mimeType: img.contentType || "image/jpeg",
        },
      });
    }
  }
  return out;
}
