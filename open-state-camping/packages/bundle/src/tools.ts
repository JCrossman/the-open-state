/**
 * MCP read tools for the local bundle: anonymous Parks Canada search,
 * availability, site details, and a prepared booking link (fallback). These run
 * on the citizen's own machine — their own IP, not a single hosted address — so
 * Parks Canada sees ordinary, distributed traffic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ParksCanadaProvider } from "@open-state/core";
import type { BundleConfig } from "./config.js";
import * as fmt from "./format.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-17 (YYYY-MM-DD).");

type TextResult = { content: { type: "text"; text: string }[] };
const text = (s: string): TextResult => ({ content: [{ type: "text", text: s }] });

function stay(start: string, end: string): string {
  return `${start} to ${end}`;
}

export function registerTools(
  server: McpServer,
  provider: ParksCanadaProvider,
  config: BundleConfig,
): void {
  const recArea = config.recreationAreaId;

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
        "end_date are arrival and departure. Set accessible_only for sites " +
        "Parks Canada marks accessible. equipment_type takes a word like " +
        '"tent" or "RV", or an equipment id from list_equipment_types.',
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
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
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
        });
        return text(
          fmt.formatSearchSites(sites, {
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
    "search_park_availability",
    {
      title: "Search a whole park for availability",
      description:
        'Check every campground in a park at once ("anything open in ' +
        'Banff?") and return one consolidated list. Then use search_sites on ' +
        "a campground that has openings. equipment_type takes a word or an id.",
      inputSchema: {
        query: z.string(),
        start_date: isoDate,
        end_date: isoDate,
        party_size: z.number().int().positive(),
        equipment_type: z.string().optional(),
        accessible_only: z.boolean().optional(),
        nights: z.number().int().positive().optional(),
        weekends_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const results = await provider.searchParkAvailability({
          query: args.query,
          startDate: args.start_date,
          endDate: args.end_date,
          partySize: args.party_size,
          equipmentType: args.equipment_type,
          accessibleOnly: args.accessible_only ?? false,
          nights: args.nights ?? null,
          weekendsOnly: args.weekends_only ?? false,
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
    "get_site_details",
    {
      title: "Get campsite details",
      description:
        "Get plain-language detail about one campsite, including accessibility. " +
        "Set include_photos to also return the site's photos as viewable images " +
        "(up to three); otherwise photo links are listed.",
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
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: fmt.formatSiteDetails(details) }];

        if (args.include_photos && details.photos.length > 0) {
          const images = await fetchPhotos(provider, details.photos, 3);
          if (images.length > 0) {
            content.push(...images);
          } else {
            content.push({ type: "text", text: fmt.formatPhotoLinks(details.photos) });
          }
        } else {
          content.push({ type: "text", text: fmt.formatPhotoLinks(details.photos) });
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
      title: "Prepare a booking link",
      description:
        "Prepare a Parks Canada booking link the citizen opens and confirms. " +
        "equipment_type is required (Parks Canada's booking page needs it): " +
        "pass the matching equipment id from list_equipment_types. This tool " +
        "never books or pays.",
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

async function fetchPhotos(
  provider: ParksCanadaProvider,
  photos: string[],
  cap: number,
): Promise<{ type: "image"; data: string; mimeType: string }[]> {
  const out: { type: "image"; data: string; mimeType: string }[] = [];
  for (const url of photos.slice(0, cap)) {
    const img = await provider.fetchPhoto(url);
    if (img) {
      out.push({
        type: "image",
        data: Buffer.from(img.bytes).toString("base64"),
        mimeType: img.contentType || "image/jpeg",
      });
    }
  }
  return out;
}
