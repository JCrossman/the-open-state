import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GoingToCampClient, ParksCanadaProvider, type FetchLike } from "@open-state/core";
import { createServerForProvider } from "../src/server.js";
import { flexibleRangeHint } from "../src/tools.js";
import { resolveDates, stayDatesProblem } from "../src/format.js";
import { normalizePhone } from "../src/account-tools.js";

const CAMPGROUND_ID = "-2147483644";
const ROOT_MAP_ID = "-2147483626";
// Far-future so the new past-date guard never trips these (fixtures are
// date-independent — the mock returns the same availability for any window).
const START = "2099-07-17";
const END = "2099-07-19";

// Fixtures live in the core package (same recorded API responses).
function fixture(name: string): unknown {
  const url = new URL(`../../core/test/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

function fixtureFetch(): FetchLike {
  return (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    let data: unknown;
    switch (u.pathname) {
      case "/api/resourceLocation":
        data = fixture("resourceLocation_min.json");
        break;
      case "/api/equipment":
        data = fixture("equipment.json");
        break;
      case "/api/resourcecategory":
        data = fixture("resourcecategory_min.json");
        break;
      case "/api/resourcelocation/resources":
        data =
          u.searchParams.get("resourceLocationId") === "-2147483642"
            ? fixture("dayuse_resources.json")
            : u.searchParams.get("resourceLocationId") === "-2147480000"
              ? fixture("bc_resources.json")
              : fixture("resources_min.json");
        break;
      case "/api/bookingcategories":
        data = fixture("bookingcategories_min.json");
        break;
      case "/api/availability/dailyactivity":
        data = fixture("dayuse_dailyactivity.json");
        break;
      case "/api/attribute/filterable":
        data = fixture("attribute_filterable_min.json");
        break;
      case "/api/availability/map":
        data =
          u.searchParams.get("mapId") === "-2147480001"
            ? fixture("bc_availability.json")
            : u.searchParams.get("mapId") === ROOT_MAP_ID
              ? fixture("availability_root.json")
              : fixture("availability_child.json");
        break;
      default:
        return new Response(JSON.stringify({ error: u.pathname }), { status: 404 });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike;
}

async function connectClient(): Promise<Client> {
  const provider = new ParksCanadaProvider({
    client: new GoingToCampClient({
      hostname: "reservation.pc.gc.ca",
      userAgent: "test",
      fetchFn: fixtureFetch(),
    }),
  });
  const server = createServerForProvider(provider, {
    recreationAreaId: "14",
    timeoutMs: 30_000,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
  };
  return res.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

describe("bundle MCP server", () => {
  it("ships server instructions that steer dates, ids, photos, and booking", async () => {
    const client = await connectClient();
    const instr = client.getInstructions() ?? "";
    // Today's real date is anchored so the assistant stops thinking dates are past.
    const today = new Date().toISOString().slice(0, 10);
    expect(instr).toContain(today);
    expect(instr).toMatch(/resolve_dates/);
    expect(instr).toMatch(/day of the week/i);
    // Don't surface internal ids / tables; embed photos as markdown; use prepare_booking.
    expect(instr).toMatch(/id numbers|internal/i);
    expect(instr).toMatch(/markdown image/i);
    expect(instr).toMatch(/prepare_booking/);
  });

  it("exposes the read tools", async () => {
    const client = await connectClient();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        "get_site_details",
        "list_equipment_types",
        "prepare_booking_url",
        "resolve_dates",
        "search_backcountry",
        "search_day_use",
        "search_park_availability",
        "search_parks",
        "search_sites",
      ].sort(),
    );
  });

  it("search_parks returns campground ids and the independence disclosure", async () => {
    const out = await callText(await connectClient(), "search_parks", { query: "Banff" });
    expect(out).toContain("campground id:");
    expect(out).toContain("not operated by or endorsed by Parks Canada");
  });

  it("search_sites surfaces accessibility and stays prepare-only", async () => {
    const out = await callText(await connectClient(), "search_sites", {
      campground_id: CAMPGROUND_ID,
      start_date: START,
      end_date: END,
      party_size: 2,
    });
    expect(out).toContain("marked accessible");
    // Steers to prepare_booking (not a deep link) and keeps internal ids hidden.
    expect(out).toMatch(/prepare the booking/i);
    expect(out).toMatch(/review and pay yourself/i);
    expect(out).toMatch(/internal id/i);
    // The stay carries a computed weekday, to ground the assistant's date sense.
    expect(out).toMatch(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat), 2099-07-17/);
  });

  it("search_park_availability consolidates and coerces ISO dates", async () => {
    const out = await callText(await connectClient(), "search_park_availability", {
      query: "Banff",
      start_date: START,
      end_date: END,
      party_size: 2,
    });
    expect(out).toContain("Availability for");
    expect(out).toContain("campground id:");
  });

  it("search_backcountry surfaces zones with accessibility and quota", async () => {
    const out = await callText(await connectClient(), "search_backcountry", {
      query: "Broken Group",
      start_date: "2026-07-15",
      end_date: "2026-07-17",
      party_size: 2,
    });
    expect(out).toContain("Hand Island");
    expect(out).toContain("accessible");
    expect(out).toMatch(/spot\(s\) left/);
    // The booking ids must be surfaced so prepare_booking gets numeric ids, not names.
    expect(out).toContain("campground_id=-2147480000");
    expect(out).toContain("product_id=5");
    expect(out).toMatch(/zone_id=-?\d+/);
  });

  it("search_backcountry with no query browses the backcountry catalog", async () => {
    const out = await callText(await connectClient(), "search_backcountry", {});
    expect(out).toContain("backcountry areas you can book");
  });

  it("search_day_use with no dates browses the Day Use product catalog", async () => {
    const out = await callText(await connectClient(), "search_day_use", {});
    expect(out).toContain("Day Use options you can book");
    expect(out).toContain("Shuttle to Lake Louise and Moraine Lake");
    expect(out).toContain("Parking");
  });

  it("search_day_use lists open timed slots with spots remaining", async () => {
    const out = await callText(await connectClient(), "search_day_use", {
      query: "Moraine Lake shuttle",
      start_date: "2026-07-15",
      end_date: "2026-07-16",
      party_size: 2,
    });
    expect(out).toContain("Moraine Lake");
    expect(out).toMatch(/spot\(s\) left/);
    // Booking ids surfaced (the fix for the day-use HTTP 500 bug): the model must get
    // the numeric campground_id + product_id + site_id, never the product name.
    expect(out).toContain("campground_id=-2147483642");
    expect(out).toContain("product_id=9");
    expect(out).toMatch(/site_id=-?\d+/);
    expect(out).toMatch(/start_date=2026-07-1[56]/);
  });

  it("search_day_use returns slots from query+start_date with NO end_date (no loop)", async () => {
    // Regression: omitting end_date (Day Use is one day) must search, not re-list products.
    const out = await callText(await connectClient(), "search_day_use", {
      query: "Moraine Lake shuttle",
      start_date: "2026-07-15",
      party_size: 2,
    });
    expect(out).toMatch(/spot\(s\) left/);
    expect(out).toContain("site_id=");
    expect(out).not.toContain("options matching"); // not the browse/list response
  });

  it("search_backcountry returns zones from query+start_date with NO end_date", async () => {
    const out = await callText(await connectClient(), "search_backcountry", {
      query: "Broken Group",
      start_date: "2026-07-15",
      party_size: 1,
    });
    expect(out).toContain("Hand Island");
    expect(out).not.toContain("areas matching"); // not the browse/list response
  });

  it("an ambiguous equipment word is flagged, not masked", async () => {
    const out = await callText(await connectClient(), "search_park_availability", {
      query: "Banff",
      start_date: START,
      end_date: END,
      party_size: 2,
      equipment_type: "tent",
    });
    expect(out).toContain("-32768");
    expect(out).not.toContain("could not check");
  });

  it("prepare_booking_url asks for equipment when missing", async () => {
    const out = await callText(await connectClient(), "prepare_booking_url", {
      campground_id: CAMPGROUND_ID,
      campsite_id: "-2147475789",
      start_date: START,
      end_date: END,
      party_size: 2,
    });
    expect(out).toContain("equipment id:");
  });

  it("prepare_booking_url returns a deep link for a valid equipment id", async () => {
    const out = await callText(await connectClient(), "prepare_booking_url", {
      campground_id: CAMPGROUND_ID,
      campsite_id: "-2147475789",
      start_date: START,
      end_date: END,
      party_size: 2,
      equipment_type: "-32768",
    });
    expect(out).toContain("create-booking/results");
    expect(out).toMatch(/never books or pays/i);
  });
});

describe("phone normalization (E.164 for Parks Canada)", () => {
  it.each([
    ["(647) 468-9893", "+16474689893"],
    ["647-468-9893", "+16474689893"],
    ["6474689893", "+16474689893"],
    ["16474689893", "+16474689893"],
    ["+1 587 986 5992", "+15879865992"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("resolve_dates (date oracle)", () => {
  it("computes the weekday and departure for a stay", () => {
    // 2099-07-17 is a known weekday; +2 nights = 2099-07-19.
    const out = resolveDates({ month: 7, day: 17, year: 2099, nights: 2 });
    expect(out).toContain("Arrival:");
    expect(out).toContain("2099-07-17");
    expect(out).toContain("Departure:");
    expect(out).toContain("2099-07-19");
    expect(out).toMatch(/start_date: 2099-07-17/);
    expect(out).toMatch(/end_date: 2099-07-19/);
    // a real weekday name is present (not guessed)
    expect(out).toMatch(/(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day/);
  });

  it("resolves the year to an upcoming occurrence when omitted (never the past)", () => {
    const out = resolveDates({ month: 7, day: 17 });
    const m = out.match(/start_date: (\d{4})-07-17/);
    expect(m).toBeTruthy();
    const today = new Date().toISOString().slice(0, 10);
    expect(`${m![1]}-07-17` >= today).toBe(true);
  });

  it("warns when an explicit year puts the date in the past", () => {
    const out = resolveDates({ month: 6, day: 16, year: 2020 });
    expect(out).toMatch(/in the past/i);
  });

  it("rejects an impossible date", () => {
    expect(resolveDates({ month: 2, day: 30 })).toMatch(/isn't a real date/i);
  });
});

describe("past-date guard (date grounding)", () => {
  it("flags a past arrival and suggests the right year", () => {
    // A bare 'June 17' the assistant resolved to last year, with today well after.
    const msg = stayDatesProblem("2020-06-17", "2020-06-18");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/in the past/i);
    expect(msg).toMatch(/today is/i);
    // suggests the same month/day in a non-past year
    expect(msg).toMatch(/-06-17/);
  });

  it("flags a departure that isn't after arrival", () => {
    const msg = stayDatesProblem("2999-06-18", "2999-06-17");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/after the arrival/i);
  });

  it("passes a valid future stay", () => {
    expect(stayDatesProblem("2999-06-17", "2999-06-18")).toBeNull();
  });
});

describe("wide-date-range guard", () => {
  it("flags a long exact-stay search instead of a false 'no availability'", () => {
    const hint = flexibleRangeHint("2026-06-01", "2026-07-01");
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/how many nights/i);
  });

  it("does not flag a normal short stay", () => {
    expect(flexibleRangeHint("2026-06-09", "2026-06-11")).toBeNull();
  });

  it("does not flag when a stay length is given", () => {
    expect(flexibleRangeHint("2026-06-01", "2026-07-01", 2)).toBeNull();
  });

  // Far-future dates so the past-date guard never fires (tests stay deterministic
  // as real time advances); the fixtures are date-independent.
  const WIDE_START = "2099-06-01";
  const WIDE_END = "2099-07-01";

  it("a wide park search without nights asks for a stay length, not 'fully booked'", async () => {
    const out = await callText(await connectClient(), "search_park_availability", {
      query: "Banff",
      start_date: WIDE_START,
      end_date: WIDE_END,
      party_size: 2,
    });
    expect(out).toMatch(/how many nights/i);
    expect(out).not.toMatch(/no campgrounds/i);
    expect(out).not.toContain("Availability for");
  });

  it("a wide park search WITH nights runs the search", async () => {
    const out = await callText(await connectClient(), "search_park_availability", {
      query: "Banff",
      start_date: WIDE_START,
      end_date: WIDE_END,
      party_size: 2,
      nights: 2,
    });
    expect(out).toContain("Availability for");
    expect(out).not.toMatch(/how many nights/i);
  });
});
