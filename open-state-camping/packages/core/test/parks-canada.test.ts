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
      case "/api/resourcelocation/resources":
        data = fixture("resources_min.json");
        break;
      case "/api/attribute/filterable":
        data = fixture("attribute_filterable_min.json");
        break;
      case "/api/availability/map":
        data =
          u.searchParams.get("mapId") === ROOT_MAP_ID
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

  it("lists equipment types with id and name", async () => {
    const types = await makeProvider().listEquipmentTypes("14");
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t.equipmentId && t.name)).toBe(true);
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
  function recordingClient(cookieProvider?: () => string | undefined) {
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
      cookieProvider,
    });
    return { client, seen };
  }

  it("sends the citizen's cookie when connected", async () => {
    const { client, seen } = recordingClient(() => "SID=abc; queue-it=xyz");
    await client.listCampgrounds();
    expect(seen.headers?.["cookie"]).toBe("SID=abc; queue-it=xyz");
  });

  it("omits the cookie header when not connected", async () => {
    const { client, seen } = recordingClient();
    await client.listCampgrounds();
    expect(seen.headers?.["cookie"]).toBeUndefined();
  });
});
