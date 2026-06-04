/**
 * Plain-language formatters for tool output — screen-reader friendly, no tables
 * or emoji (Constitution Art. 3). Ported from the Python `server.py` builders.
 */
import {
  InvalidInputError,
  QueueItError,
  UpstreamError,
  addDays,
  isoFromParts,
  nextOccurrence,
  todayUTC,
  weekdayLongName,
  weekdayName,
  type AvailableSite,
  type CampgroundAvailability,
  type EquipmentType,
  type RecreationArea,
  type SiteDetails,
} from "@open-state/core";

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
    lines.push(`- ${c.name} (campground id: ${c.campgroundId})`);
  }
  lines.push(
    "",
    `Next, search for open sites using recreation area id ${area.recreationAreaId} ` +
      "and one of the campground ids above, along with your dates and party size.",
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

export function formatSearchSites(
  sites: AvailableSite[],
  opts: { stay: string; partySize: number; accessibleOnly: boolean },
): string {
  if (sites.length === 0) {
    let msg = `No open sites were found in that campground for ${opts.stay}, party of ${opts.partySize}`;
    msg += opts.accessibleOnly ? " (accessible sites only)." : ".";
    msg +=
      " Sites in popular parks fill quickly. You can ask me to watch this " +
      "search and alert you if one opens up.";
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
    lines.push(`- ${parts.join("; ")} (campsite id: ${site.campsiteId})`);
  }
  if (sites.length > 25) {
    lines.push(`- ... and ${sites.length - 25} more open site(s).`);
  }
  lines.push(
    "",
    "To book, open this link in your browser, sign in to your own Parks " +
      "Canada account, choose your exact site, and confirm:",
    sites[0]!.bookingUrl ?? "",
    "",
    "This tool prepares the booking only. You complete and pay for it " +
      "yourself in your Parks Canada session; it never books or pays for you.",
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
