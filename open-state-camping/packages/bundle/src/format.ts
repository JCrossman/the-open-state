/**
 * Plain-language formatters for tool output — screen-reader friendly, no tables
 * or emoji (Constitution Art. 3).
 */
import {
  InvalidInputError,
  QueueItError,
  SEARCHABLE_BOOKING_GROUPS,
  UpstreamError,
  addDays,
  isoFromParts,
  nextOccurrence,
  todayUTC,
  weekdayLongName,
  weekdayName,
  type AvailableSite,
  type BackcountryProduct,
  type BackcountryZone,
  type CampgroundAvailability,
  type DayUseProduct,
  type DayUseSlot,
  type EquipmentType,
  type RecreationArea,
  type SiteDetails,
} from "@open-state/core";

/** Render a campground's offered booking groups, flagging not-yet-searchable ones. */
function offersLine(offers: string[] | undefined): string {
  if (!offers || offers.length === 0) return "";
  const rendered = offers.map((g) =>
    SEARCHABLE_BOOKING_GROUPS.has(g as never) ? g : `${g} (not yet searchable here)`,
  );
  return ` — offers: ${rendered.join(", ")}`;
}

/**
 * Resolve a citizen's date (month/day, optional year) into exact calendar dates
 * with the correct weekday — the date arithmetic the assistant is unreliable at.
 * Year omitted → the next upcoming occurrence (this runs on the citizen's machine,
 * so "today" is real). `nights` also yields the departure date.
 */
export function resolveDates(args: {
  month: number;
  day: number;
  year?: number;
  nights?: number;
}): string {
  const today = todayUTC();
  const todayYear = Number(today.slice(0, 4));
  // Pick the year: the one given, else this year — or next year if that day has
  // already passed.
  let year = args.year ?? todayYear;
  if (args.year == null) {
    const thisYear = isoFromParts(todayYear, args.month, args.day);
    if (thisYear && thisYear < today) year = todayYear + 1;
  }
  const start = isoFromParts(year, args.month, args.day);
  if (!start) {
    return (
      `That isn't a real date (month ${args.month}, day ${args.day}). ` +
      `Give a month 1-12 and a day that exists in it.`
    );
  }

  const lines = [`Today is ${weekdayLongName(today)}, ${today}.`, ""];
  lines.push(`Arrival: ${weekdayLongName(start)}, ${start}`);
  let end: string | null = null;
  if (args.nights != null) {
    end = addDays(start, args.nights);
    lines.push(
      `Departure: ${weekdayLongName(end)}, ${end} ` +
        `(${args.nights} night${args.nights === 1 ? "" : "s"})`,
    );
  }
  if (start < today) {
    lines.push(
      "",
      `Heads up: that arrival is in the past. The next ${args.month}/${args.day} is ` +
        `${withWeekday(nextOccurrence(start))} — leave the year off to use it.`,
    );
  }
  lines.push("", "Use these exact dates when searching or booking:");
  lines.push(`- start_date: ${start}`);
  if (end) lines.push(`- end_date: ${end}`);
  return lines.join("\n");
}

/** A date with its weekday, e.g. "Wed, 2026-06-17" — grounds the assistant,
 *  which can otherwise confabulate the weekday or year from a bare date. */
export function withWeekday(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${weekdayName(iso)}, ${iso}` : iso;
}

/**
 * Catch impossible stay dates before searching/booking, returning a correcting
 * message (or null if fine). The tool — running on the citizen's machine — is
 * the authority on today's date, so a past arrival is almost always the
 * assistant resolving a bare date ("June 17") to the wrong year. We state
 * today's real date and suggest the right year rather than returning an empty
 * result the assistant then "explains" as the date being in the past.
 */
export function stayDatesProblem(start: string, end: string): string | null {
  const today = todayUTC();
  if (start < today) {
    const suggested = nextOccurrence(start);
    return (
      `That arrival date, ${withWeekday(start)}, is in the past — today is ` +
      `${withWeekday(today)}. You most likely mean ${withWeekday(suggested)}; ` +
      `search again with that date. (Parks Canada only has availability for ` +
      `today onward.)`
    );
  }
  if (end <= start) {
    return (
      `The departure date (${withWeekday(end)}) needs to be after the arrival ` +
      `date (${withWeekday(start)}). For a one-night stay, depart the next day.`
    );
  }
  return null;
}

export const INDEPENDENCE_NOTE =
  "The Open State is an independent public-interest tool. " +
  "It is not operated by or endorsed by Parks Canada.";

const NOT_FOUND_HINT =
  "Try a national park name such as Banff, Jasper, or Pacific Rim.";

/** Turn an error into a plain-language message for the citizen (Art. 7.2). */
export function problem(err: unknown): string {
  if (
    err instanceof InvalidInputError ||
    err instanceof QueueItError ||
    err instanceof UpstreamError
  ) {
    return err.message;
  }
  // Unexpected: log for the operator, surface a friendly line to the citizen.
  console.error("Unexpected error serving a tool call:", err);
  return (
    "Sorry, something went wrong while reaching the Parks Canada booking " +
    "system. Please try again in a moment."
  );
}

export function formatSearchParks(query: string, areas: RecreationArea[]): string {
  if (areas.length === 0) {
    return (
      `I could not find a Parks Canada campground matching "${query}". ` +
      NOT_FOUND_HINT
    );
  }
  const area = areas[0]!;
  const lines = [
    `Found ${area.campgrounds.length} Parks Canada campground(s) matching ` +
      `"${query}". ${INDEPENDENCE_NOTE}`,
    "",
    "Campgrounds:",
  ];
  for (const c of area.campgrounds) {
    lines.push(`- ${c.name} (campground id: ${c.campgroundId})${offersLine(c.offers)}`);
  }
  // Orient the citizen among the kinds of stay, grounded in what these parks offer.
  const offered = new Set(area.campgrounds.flatMap((c) => c.offers ?? []));
  if (offered.size > 0) {
    const searchable = [...offered].filter((g) => SEARCHABLE_BOOKING_GROUPS.has(g as never));
    lines.push(
      "",
      "Parks Canada has different kinds of stay. Here you can search " +
        `${searchable.join(" and ")} — for accommodations (oTENTik, cabin, yurt) ` +
        "pass category = accommodation; for group sites pass category = group; " +
        "otherwise it searches regular campsites.",
    );
  }
  lines.push(
    "",
    `Next, search for open sites using recreation area id ${area.recreationAreaId} ` +
      "and one of the campground ids above, along with your dates and party size.",
  );
  return lines.join("\n");
}

/** Date check for Day Use: a single day is fine (start may equal end), but no past. */
export function dayUseDatesProblem(start: string, end: string): string | null {
  const today = todayUTC();
  if (start < today) {
    const suggested = nextOccurrence(start);
    return (
      `That date, ${withWeekday(start)}, is in the past — today is ` +
      `${withWeekday(today)}. You most likely mean ${withWeekday(suggested)}; ` +
      `search again with that date.`
    );
  }
  if (end < start) {
    return `The end date (${withWeekday(end)}) can't be before the start date (${withWeekday(start)}).`;
  }
  return null;
}

export function formatBackcountryProducts(
  products: BackcountryProduct[],
  query?: string,
): string {
  if (products.length === 0) {
    return query
      ? `No backcountry area matched "${query}". Ask me to list all backcountry options.`
      : "No backcountry areas were found.";
  }
  const lines = [
    query
      ? `Backcountry areas matching "${query}":`
      : "Parks Canada backcountry areas you can book:",
    "",
  ];
  for (const p of products) lines.push(`- ${p.product}`);
  lines.push(
    "",
    "Tell me an area, your dates, and party size and I'll check which zones have room " +
      "each night (e.g. \"Broken Group Islands for July 15-17, party of 2\"). A trip " +
      "is built one zone per night.",
  );
  return lines.join("\n");
}

export function formatBackcountry(
  query: string,
  zones: BackcountryZone[],
  opts: { stay: string; partySize: number; accessibleOnly: boolean },
): string {
  if (zones.length === 0) {
    let msg = `No backcountry zones with room for a party of ${opts.partySize} were found for "${query}" over ${opts.stay}`;
    msg += opts.accessibleOnly ? " (accessible zones only)." : ".";
    return (
      msg +
      " Backcountry quotas are small and go fast — try other dates or a nearby area, " +
      "or ask me to list backcountry options."
    );
  }
  const accessibleCount = zones.filter((z) => z.accessible).length;
  const byProduct = new Map<string, BackcountryZone[]>();
  for (const z of zones) {
    (byProduct.get(z.product) ?? byProduct.set(z.product, []).get(z.product)!).push(z);
  }
  const lines = [
    `Backcountry zones with room for a party of ${opts.partySize} over ${opts.stay}` +
      (opts.accessibleOnly ? " (accessible only)" : "") +
      `. ${accessibleCount} of them are marked accessible. ${INDEPENDENCE_NOTE}`,
  ];
  for (const [area, zs] of byProduct) {
    // The area (facility) and its product id are constant for the group; show once.
    const g = zs[0]!;
    lines.push("", `${area}  [book with campground_id=${g.campgroundId}, product_id=${g.productId}]:`);
    for (const z of zs) {
      const nights =
        z.openNights.length === 1
          ? z.openNights[0]
          : `${z.openNights[0]} … ${z.openNights[z.openNights.length - 1]} (${z.openNights.length} nights)`;
      const acc = z.accessible ? "accessible" : "not marked accessible";
      lines.push(
        `  - ${z.zoneName} — ${acc}; available on ${nights}  ` +
          `[zone_id=${z.zoneId}; open nights: ${z.openNights.join(", ")}]`,
      );
    }
  }
  lines.push(
    "",
    "A backcountry trip is one zone per night. To prepare it, call prepare_booking with " +
      "the campground_id and product_id shown for the area, and an itinerary of " +
      "{zone_id, start_date, end_date} — one entry per night, end_date the next morning. " +
      "I take it to the payment screen for you to review and pay yourself. Don't show " +
      "the citizen these internal ids.",
  );
  return lines.join("\n");
}

export function formatDayUseProducts(products: DayUseProduct[], query?: string): string {
  if (products.length === 0) {
    return query
      ? `No Day Use product matched "${query}". Ask me to list all Day Use options.`
      : "No Day Use products were found.";
  }
  const lines = [
    query
      ? `Day Use options matching "${query}":`
      : "Parks Canada Day Use options you can book:",
    "",
  ];
  for (const p of products) lines.push(`- ${p.product}`);
  lines.push(
    "",
    "Tell me which one, plus the date and party size, and I'll check the open times " +
      "(e.g. \"Moraine Lake shuttle times for July 15, party of 2\").",
  );
  return lines.join("\n");
}

export function formatDayUse(
  query: string,
  slots: DayUseSlot[],
  opts: { stay: string; partySize: number },
): string {
  if (slots.length === 0) {
    return (
      `No open Day Use times were found for "${query}" on ${opts.stay}, party of ` +
      `${opts.partySize}. Day Use passes (shuttles, parking, guided events) often ` +
      "release on a fixed schedule and sell out fast — try other dates, or check " +
      "whether bookings for that date have opened yet."
    );
  }
  // Group by product, then by day, so the citizen reads "this shuttle, this day, these times".
  const byProduct = new Map<string, DayUseSlot[]>();
  for (const s of slots) {
    (byProduct.get(s.product) ?? byProduct.set(s.product, []).get(s.product)!).push(s);
  }
  const lines = [
    `Found open Day Use times for "${query}" on ${opts.stay}, party of ${opts.partySize}. ` +
      INDEPENDENCE_NOTE,
  ];
  for (const [product, ps] of byProduct) {
    lines.push("", product + ":");
    const byDay = new Map<string, DayUseSlot[]>();
    for (const s of ps) {
      (byDay.get(s.date) ?? byDay.set(s.date, []).get(s.date)!).push(s);
    }
    for (const [date, ds] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${date}:`);
      for (const s of ds) {
        // Carry the full booking tuple per slot — prepare_booking needs the numeric
        // campground_id (facility) and product_id, not the product name. Day Use
        // products can span several facilities, so put the ids on each line.
        lines.push(
          `    - ${s.slotName} — ${s.remaining} spot(s) left  ` +
            `[to book: campground_id=${s.campgroundId}, product_id=${s.productId}, ` +
            `site_id=${s.slotId}, start_date=${s.date}]`,
        );
      }
    }
  }
  lines.push(
    "",
    // Honest accessibility note: Day Use slots don't expose an accessibility
    // attribute the way campsites do, so we don't claim one. Point the citizen to
    // the park rather than leave an accessibility need unanswered.
    "Accessibility (accessible boarding, parking, or facilities) isn't listed per " +
      "time here — contact the park to confirm what you need before you pay.",
    "To book a time, call prepare_booking with the campground_id, product_id, " +
      "site_id, and start_date shown in brackets for it (they are numeric ids — pass " +
      "them exactly, not the product name). I take it to the payment screen and you " +
      "review and pay yourself. Don't show the citizen these internal ids.",
  );
  return lines.join("\n");
}

export function formatEquipmentTypes(types: EquipmentType[]): string {
  if (types.length === 0) {
    return "No equipment types were returned for that recreation area.";
  }
  const lines = ["Equipment types you can filter sites by:"];
  for (const t of types) lines.push(`- ${t.name} (equipment id: ${t.equipmentId})`);
  lines.push(
    "",
    "Pass one of these equipment ids as equipment_type when you search for sites.",
  );
  return lines.join("\n");
}

const CATEGORY_NOUN: Record<string, string> = {
  campsite: "campsites",
  group: "group sites",
  accommodation: "accommodations (oTENTik, cabin, yurt)",
};

export function formatSearchSites(
  sites: AvailableSite[],
  opts: {
    stay: string;
    partySize: number;
    accessibleOnly: boolean;
    category?: string;
    offers?: string[];
  },
): string {
  if (sites.length === 0) {
    const noun = CATEGORY_NOUN[opts.category ?? "campsite"] ?? "sites";
    let msg = `No open ${noun} were found in that campground for ${opts.stay}, party of ${opts.partySize}`;
    msg += opts.accessibleOnly ? " (accessible sites only)." : ".";
    // Ground the citizen: name what this campground does offer, so an empty
    // accommodation search doesn't look like the park has none at all.
    if (opts.offers && opts.offers.length > 0) {
      msg += ` This campground offers ${opts.offers.join(", ")}.`;
    }
    msg +=
      " Sites in popular parks fill quickly — you can try other dates, or ask me " +
      "to watch this search and alert you if one opens up.";
    return msg;
  }

  const accessibleCount = sites.filter((s) => s.accessible).length;
  const header = opts.accessibleOnly
    ? `Found ${sites.length} accessible open site(s) for ${opts.stay}, party of ${opts.partySize}.`
    : `Found ${sites.length} open site(s) for ${opts.stay}, party of ${opts.partySize}. ` +
      `${accessibleCount} of them are marked accessible.`;
  const lines = [header, ""];
  for (const site of sites.slice(0, 25)) {
    const parts = [`Site ${site.siteName}`];
    parts.push(site.accessible ? "accessible" : "not marked accessible");
    if (site.siteType) parts.push(site.siteType);
    if (site.maxOccupancy) parts.push(`sleeps up to ${site.maxOccupancy}`);
    // The id is for tool calls only — keep it out of the part the citizen reads.
    lines.push(`- ${parts.join("; ")}  [internal id ${site.campsiteId}]`);
  }
  if (sites.length > 25) {
    lines.push(`- ... and ${sites.length - 25} more open site(s).`);
  }
  lines.push(
    "",
    "Tell me which site you'd like (or ask for its details and photos) and I'll " +
      "prepare the booking — I take it right up to the payment screen and you " +
      "review and pay yourself. Don't show the citizen the internal id numbers.",
  );
  return lines.join("\n");
}

export function formatParkAvailability(
  query: string,
  results: CampgroundAvailability[],
  opts: { stay: string; partySize: number; accessibleOnly: boolean },
): string {
  if (results.length === 0) {
    return (
      `I could not find a Parks Canada park matching "${query}". ` + NOT_FOUND_HINT
    );
  }
  const acc = opts.accessibleOnly ? " (accessible sites only)" : "";
  const withSites = results.filter((r) => r.openSiteCount > 0);
  const empty = results.filter((r) => r.openSiteCount === 0 && !r.error);
  const errored = results.filter((r) => r.error);

  const lines = [
    `Availability for "${query}", ${opts.stay}, party of ${opts.partySize}${acc}. ` +
      INDEPENDENCE_NOTE,
    "",
  ];

  if (withSites.length > 0) {
    lines.push("Campgrounds with openings:");
    for (const r of withSites) {
      const note = r.accessibleCount ? `, ${r.accessibleCount} marked accessible` : "";
      lines.push(
        `- ${r.campgroundName}: ${r.openSiteCount} open site(s)${note} ` +
          `(campground id: ${r.campgroundId})`,
      );
    }
    lines.push(
      "",
      "Use search_sites with one of these campground ids to see the " +
        "individual sites, then prepare_booking_url to book in your own " +
        "Parks Canada session. This tool never books.",
    );
  } else if (empty.length > 0) {
    lines.push(
      "No campgrounds I could check in that park have open sites for those " +
        "dates. Sites in popular parks fill quickly; you can ask me to watch " +
        "a specific campground and alert you if one opens up.",
    );
  } else {
    lines.push(
      "I could not reach the booking system to check this park's " +
        "campgrounds right now, so I have no availability to report. Please " +
        "try again in a moment.",
    );
  }

  if (empty.length > 0 && withSites.length > 0) {
    lines.push("", "No openings at: " + empty.map((r) => r.campgroundName).join(", ") + ".");
  }
  if (errored.length > 0) {
    lines.push(
      "",
      "I could not check these, so there may be openings here I am not " +
        "seeing: " +
        errored.map((r) => r.campgroundName).join(", ") +
        ". You can try them individually with search_sites.",
    );
  }
  return lines.join("\n");
}

export function formatSiteDetails(details: SiteDetails): string {
  const lines = [
    `Site ${details.siteName}${details.accessible ? " (marked accessible)" : ""}.`,
  ];
  for (const note of details.accessibilityNotes) lines.push(note);
  if (details.siteType) lines.push(`Service type: ${details.siteType}.`);
  if (details.maxOccupancy) lines.push(`Sleeps up to ${details.maxOccupancy}.`);
  if (details.amenities.length > 0) {
    lines.push("Amenities:");
    for (const a of details.amenities) lines.push(`- ${a}`);
  }
  return lines.join("\n");
}

export function formatPhotoLinks(photos: string[]): string {
  if (photos.length === 0) return "No photos are available for this site.";
  return (
    "Photos (open in a browser):\n" + photos.map((p) => `  ${p}`).join("\n")
  );
}
