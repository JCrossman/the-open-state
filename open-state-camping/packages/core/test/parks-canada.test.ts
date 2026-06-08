import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  allowedNotifyHosts,
  evaluateStay,
  GoingToCampClient,
  InvalidInputError,
  ParksCanadaProvider,
  validateNotifyTarget,
  windowNights,
  type FetchLike,
} from "../src/index.js";

// Test campground: Banff - Tunnel Mountain Trailer Court (matches the fixtures).
const CAMPGROUND_ID = "-2147483644";
const ROOT_MAP_ID = "-2147483626";
const SITE_104 = "-2147475789"; // accessible; open both nights
const START = "2026-07-17";
const END = "2026-07-19"; // 2-night stay

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/** Route requests to recorded fixtures, mirroring the Python conftest handler. */
function fixtureFetch(): FetchLike {
  return (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    const path = u.pathname;
    let data: unknown;
    switch (path) {
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
        return new Response(JSON.stringify({ error: `unexpected ${path}` }), {
          status: 404,
        });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike;
}

function makeProvider(): ParksCanadaProvider {
  const client = new GoingToCampClient({
    hostname: "reservation.pc.gc.ca",
    userAgent: "test",
    fetchFn: fixtureFetch(),
  });
  return new ParksCanadaProvider({ client });
}

function search(overrides: Partial<Parameters<ParksCanadaProvider["searchSites"]>[0]> = {}) {
  return makeProvider().searchSites({
    recreationAreaId: "14",
    campgroundId: CAMPGROUND_ID,
    startDate: START,
    endDate: END,
    partySize: 2,
    ...overrides,
  });
}

describe("ParksCanadaProvider — search", () => {
  it("resolves campgrounds for a park name", async () => {
    const areas = await makeProvider().searchParks("Banff");
    expect(areas).toHaveLength(1);
    expect(areas[0]!.recreationAreaId).toBe("14");
    const ids = areas[0]!.campgrounds.map((c) => c.campgroundId);
    expect(ids).toContain(CAMPGROUND_ID);
    expect(areas[0]!.campgrounds.find((c) => c.campgroundId === CAMPGROUND_ID)!.name).toContain(
      "Banff",
    );
  });

  it("returns nothing for a non-Canada country", async () => {
    expect(await makeProvider().searchParks("anything", "US")).toEqual([]);
  });

  it("surfaces the booking groups each campground offers", async () => {
    const areas = await makeProvider().searchParks("Banff");
    const cgs = areas[0]!.campgrounds;
    // -2147483644 is campsite+overflow (frontcountry only); -2147483643 adds an oTENTik.
    expect(cgs.find((c) => c.campgroundId === CAMPGROUND_ID)!.offers).toEqual([
      "Frontcountry Camping",
    ]);
    expect(cgs.find((c) => c.campgroundId === "-2147483643")!.offers).toEqual([
      "Frontcountry Camping",
      "Accommodations",
    ]);
  });

  it("resolves a zone permit's capacity category from the PRODUCT, not the zone", async () => {
    // Regression: the 5th capacity count must use the product's additionalCapacity
    // CategoryId (constant), not the zone's zoneCapacitySettings (varies per zone) —
    // the wrong source produced -32767 for Lean-to Les Lacs and an InvalidCart.
    expect(await makeProvider().backcountryCapacityCategory(5)).toBe(-32766);
  });

  it("reports a single campground's offerings by id", async () => {
    expect(await makeProvider().campgroundOfferings(CAMPGROUND_ID)).toEqual([
      "Frontcountry Camping",
    ]);
    expect(await makeProvider().campgroundOfferings("-2147483643")).toEqual([
      "Frontcountry Camping",
      "Accommodations",
    ]);
  });

  it("lists equipment types with id and name", async () => {
    const types = await makeProvider().listEquipmentTypes("14");
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t.equipmentId && t.name)).toBe(true);
  });

  it("offers only frontcountry equipment, not backcountry types", async () => {
    // The platform's /api/equipment has a frontcountry category (Small/Medium/
    // Large Tent, …) and a separate Backcountry category (Single Tent, 2 Tents, …).
    // We search frontcountry, so a backcountry type would silently yield zero.
    const types = await makeProvider().listEquipmentTypes("14");
    const names = types.map((t) => t.name);
    expect(names).toContain("Small Tent");
    expect(names).not.toContain("Single Tent");
    expect(names.some((n) => /^\d+ Tents$/.test(n))).toBe(false);
  });

  it("rejects a backcountry equipment word instead of silently returning nothing", async () => {
    await expect(search({ equipmentType: "single tent" })).rejects.toThrow(InvalidInputError);
  });

  it("returns sites with accessibility surfaced, accessible first", async () => {
    const sites = await search();
    expect(sites.length).toBeGreaterThan(0);
    const site104 = sites.find((s) => s.campsiteId === SITE_104);
    expect(site104).toBeDefined();
    expect(site104!.siteName).toBe("104");
    expect(site104!.accessible).toBe(true);
    // accessible sites sort ahead of non-accessible ones
    const firstNonAccessible = sites.findIndex((s) => !s.accessible);
    const lastAccessible = sites.map((s) => s.accessible).lastIndexOf(true);
    if (firstNonAccessible !== -1) expect(lastAccessible).toBeLessThan(firstNonAccessible);
  });

  it("accessible_only keeps only accessible sites", async () => {
    const sites = await search({ accessibleOnly: true });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.accessible)).toBe(true);
  });

  it("defaults to campsites and labels them by resource category", async () => {
    const sites = await search();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.siteType === "Campsite")).toBe(true);
  });

  it("filters by category — accommodation search excludes campsite resources", async () => {
    // The fixtures are all Campsite-category, so an accommodation search finds none.
    expect(await search({ category: "accommodation" })).toEqual([]);
    expect(await search({ category: "group" })).toEqual([]);
    expect((await search({ category: "campsite" })).length).toBeGreaterThan(0);
  });
});

describe("ParksCanadaProvider — Day Use (model 1)", () => {
  it("finds open timed slots for a matched product, filtered by party size", async () => {
    const slots = await makeProvider().searchDayUse({
      query: "Moraine Lake shuttle",
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      partySize: 2,
    });
    expect(slots.length).toBeGreaterThan(0);
    // The fixture's 0-quota slot must be dropped; everything returned fits the party.
    expect(slots.every((s) => s.remaining >= 2)).toBe(true);
    expect(slots.every((s) => s.product.includes("Moraine Lake"))).toBe(true);
    // Slots carry the facility id (for booking reuse) and a human time-slot name.
    expect(slots[0]!.campgroundId).toBe("-2147483642");
    expect(slots.some((s) => /\d(am|pm)/i.test(s.slotName))).toBe(true);
  });

  it("excludes slots that cannot seat the whole party", async () => {
    const slots = await makeProvider().searchDayUse({
      query: "shuttle",
      startDate: "2026-07-15",
      endDate: "2026-07-16",
      partySize: 9, // only the 10-quota slot qualifies
    });
    expect(slots.every((s) => s.remaining >= 9)).toBe(true);
  });

  it("returns nothing when no product matches the query", async () => {
    expect(
      await makeProvider().searchDayUse({
        query: "zzzznotaproduct",
        startDate: "2026-07-15",
        endDate: "2026-07-16",
      }),
    ).toEqual([]);
  });

  it("browses the Day Use catalog (model 1 only), and narrows by query", async () => {
    const all = await makeProvider().listDayUseProducts();
    // Fixture has 3 model-1 products + 1 model-0 campsite; only the 3 are Day Use.
    expect(all.map((p) => p.product)).toEqual([
      "Lake O'Hara Day Use Bus",
      "Parking",
      "Shuttle to Lake Louise and Moraine Lake",
    ]);
    const moraine = await makeProvider().listDayUseProducts("moraine");
    expect(moraine).toHaveLength(1);
    expect(moraine[0]!.productId).toBe("9");
    expect(moraine[0]!.campgroundId).toBe("-2147483642");
  });
});

describe("ParksCanadaProvider — Backcountry (model 5)", () => {
  it("browses the backcountry catalog by area (facility — product)", async () => {
    const all = await makeProvider().listBackcountryProducts();
    const bg = all.find((p) => p.product.includes("Broken Group Islands"));
    expect(bg).toBeDefined();
    expect(bg!.campgroundId).toBe("-2147480000");
    expect(bg!.productId).toBe("5");
  });

  it("reads availability as a status (0 = available, non-zero = full), per night", async () => {
    const zones = await makeProvider().searchBackcountry({
      query: "Broken Group",
      startDate: "2026-07-15",
      endDate: "2026-07-17", // two nights
      partySize: 1,
    });
    // Fixture: Hand Island [0,0] = available both nights; Turret [0,5] = night 1 only.
    const hand = zones.find((z) => z.zoneName === "Hand Island")!;
    expect(hand.accessible).toBe(true);
    expect(hand.openNights).toEqual(["2026-07-15", "2026-07-16"]);
    expect(hand.campgroundId).toBe("-2147480000"); // facility, for booking reuse
    // Non-inversion regression: night 2's status 5 must NOT be reported as available.
    const turret = zones.find((z) => z.zoneName === "Turret Island")!;
    expect(turret.openNights).toEqual(["2026-07-15"]);
  });

  it("accessible_only keeps only accessible zones", async () => {
    const zones = await makeProvider().searchBackcountry({
      query: "Broken Group",
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      partySize: 1,
      accessibleOnly: true,
    });
    expect(zones.every((z) => z.accessible)).toBe(true);
    expect(zones.map((z) => z.zoneName)).toEqual(["Hand Island"]);
  });
});

describe("resource category constants (corrected)", () => {
  it("maps Group and Overflow to their real ids, not Yurt/oTENTik", async () => {
    const { CATEGORY_GROUPS, RESOURCE_CATEGORY } = await import("../src/index.js");
    expect(RESOURCE_CATEGORY.group).toBe(-2147483640);
    expect(RESOURCE_CATEGORY.overflow).toBe(-2147483641);
    expect(RESOURCE_CATEGORY.otentik).toBe(-2147483643); // was mislabeled GROUP_SITE
    expect(RESOURCE_CATEGORY.yurt).toBe(-2147483647); // was mislabeled OVERFLOW_SITE
    expect(CATEGORY_GROUPS.accommodation.has(RESOURCE_CATEGORY.otentik)).toBe(true);
    expect(CATEGORY_GROUPS.campsite.has(RESOURCE_CATEGORY.group)).toBe(false);
  });
});

describe("ParksCanadaProvider — equipment resolution", () => {
  it("accepts a known equipment id", async () => {
    expect((await search({ equipmentType: "-32768" })).length).toBeGreaterThan(0);
  });

  it("accepts an unambiguous equipment word", async () => {
    expect(Array.isArray(await search({ equipmentType: "van" }))).toBe(true);
  });

  it("flags an ambiguous equipment word, listing the options", async () => {
    await expect(search({ equipmentType: "tent" })).rejects.toThrow(InvalidInputError);
    await expect(search({ equipmentType: "tent" })).rejects.toThrow("-32768");
  });

  it("flags an unknown equipment word", async () => {
    await expect(search({ equipmentType: "submarine" })).rejects.toThrow(InvalidInputError);
  });

  it("flags an unknown equipment id", async () => {
    await expect(search({ equipmentType: "999999" })).rejects.toThrow(InvalidInputError);
  });

  it("validates equipment once for a park-wide search (fail fast)", async () => {
    await expect(
      makeProvider().searchParkAvailability({
        query: "Banff",
        startDate: START,
        endDate: END,
        partySize: 2,
        equipmentType: "tent",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("consolidates a whole-park search", async () => {
    const results = await makeProvider().searchParkAvailability({
      query: "Banff",
      startDate: START,
      endDate: END,
      partySize: 2,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.openSiteCount > 0)).toBe(true);
  });
});

describe("notify-target hardening", () => {
  const ntfy = allowedNotifyHosts({ ntfyBase: "https://ntfy.sh" });

  it("allows the configured ntfy host", () => {
    expect(() => validateNotifyTarget("https://ntfy.sh/openstate-abc", ntfy)).not.toThrow();
  });

  it.each([
    "not-a-url",
    "ftp://ntfy.sh/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/x",
    "http://[::1]/x",
    "http://10.1.2.3/x",
    "https://evil.example.com/relay",
  ])("rejects unsafe target %s", (bad) => {
    expect(() => validateNotifyTarget(bad, ntfy)).toThrow(InvalidInputError);
  });
});

describe("availability helpers", () => {
  it("computes window nights as [arrival, departure)", () => {
    expect(windowNights("2026-07-17", "2026-07-19")).toEqual(["2026-07-17", "2026-07-18"]);
  });

  it("requires every night open by default", () => {
    const window = ["2026-07-17", "2026-07-18"];
    expect(evaluateStay(["2026-07-17", "2026-07-18"], window, null, false).qualifies).toBe(true);
    expect(evaluateStay(["2026-07-17"], window, null, false).qualifies).toBe(false);
  });

  it("finds a run of N consecutive open nights", () => {
    const window = ["2026-07-17", "2026-07-18", "2026-07-19"];
    expect(evaluateStay(["2026-07-18", "2026-07-19"], window, 2, false).dates).toEqual([
      "2026-07-18",
      "2026-07-19",
    ]);
  });
});

describe("authenticated requests", () => {
  function recordingClient(authHeaders?: () => Record<string, string> | undefined) {
    const seen: { headers?: Record<string, string> } = {};
    const fetchFn = (async (_input: unknown, init: RequestInit | undefined) => {
      seen.headers = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchLike;
    const client = new GoingToCampClient({
      hostname: "reservation.pc.gc.ca",
      userAgent: "test",
      fetchFn,
      authHeaders,
    });
    return { client, seen };
  }

  it("sends the citizen's cookie and XSRF header when connected", async () => {
    const { client, seen } = recordingClient(() => ({
      Cookie: "SID=abc; XSRF-TOKEN=tok",
      "X-XSRF-TOKEN": "tok",
    }));
    await client.listCampgrounds();
    expect(seen.headers?.["cookie"]).toBe("SID=abc; XSRF-TOKEN=tok");
    expect(seen.headers?.["x-xsrf-token"]).toBe("tok");
  });

  it("omits auth headers when not connected", async () => {
    const { client, seen } = recordingClient();
    await client.listCampgrounds();
    expect(seen.headers?.["cookie"]).toBeUndefined();
    expect(seen.headers?.["x-xsrf-token"]).toBeUndefined();
  });

  it("posts state-changing writes with cookie, XSRF, and a JSON body", async () => {
    const seen: { method?: string; headers?: Record<string, string>; body?: string } = {};
    const fetchFn = (async (_input: unknown, init: RequestInit | undefined) => {
      seen.method = init?.method;
      seen.headers = Object.fromEntries(new Headers(init?.headers).entries());
      seen.body = init?.body as string;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchLike;
    const client = new GoingToCampClient({
      hostname: "reservation.pc.gc.ca",
      userAgent: "test",
      fetchFn,
      authHeaders: () => ({ Cookie: "SID=1; XSRF-TOKEN=tok", "X-XSRF-TOKEN": "tok" }),
    });
    await client.updateShopper({ firstName: "Jeremy", phoneNumbers: { primaryPhoneNumber: "+1555" } });
    expect(seen.method).toBe("POST");
    expect(seen.headers?.["x-xsrf-token"]).toBe("tok");
    expect(seen.headers?.["cookie"]).toContain("SID=1");
    expect(seen.headers?.["content-type"]).toBe("application/json");
    expect(JSON.parse(seen.body!)).toEqual({
      firstName: "Jeremy",
      phoneNumbers: { primaryPhoneNumber: "+1555" },
    });
  });

  it("unwraps the currentVersion profile from GET /api/shopper", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          shopperUid: "x",
          currentVersion: { firstName: "Jeremy", phoneNumbers: { primaryPhoneNumber: "+1" } },
          history: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as FetchLike;
    const client = new GoingToCampClient({
      hostname: "reservation.pc.gc.ca",
      userAgent: "test",
      fetchFn,
    });
    const profile = await client.getShopper();
    expect(profile?.["firstName"]).toBe("Jeremy");
    expect(profile?.["shopperUid"]).toBeUndefined(); // wrapper stripped
  });
});
