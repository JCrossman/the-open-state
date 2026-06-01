/**
 * Thin HTTP client for the GoingToCamp / Camis platform (Parks Canada).
 *
 * Implements the endpoint contract verified live in
 * docs/parks-canada-api-findings.md. This client only *reads* public availability
 * and resource data and *builds* a booking deep link; it never logs in, books, or
 * handles citizen credentials (Constitution Articles 1 and 2).
 */
import type { ISODate } from "./types.js";
import {
  ACCESSIBLE_ATTR,
  CAMPSITE_CATEGORIES,
  DEFAULT_USER_AGENT,
  MAX_MAP_REQUESTS,
  NON_GROUP_EQUIPMENT,
} from "./constants.js";
import { QueueItError, UpstreamError } from "./errors.js";
import { localized } from "./util.js";

/** A `fetch`-shaped function, injectable so tests run fully offline. */
export type FetchLike = typeof fetch;

export interface CampgroundRecord {
  resourceLocationId: number | string;
  name: string;
  rootMapId: number | string;
}

export interface EquipmentRecord {
  equipmentId: number;
  name: string;
}

/** Per-day availability code list, keyed by `resourceId`. */
export type DailyAvailability = Record<string, (number | null)[]>;

export class GoingToCampClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  /**
   * Returns the citizen's auth headers (e.g. `Cookie` and the Angular
   * `X-XSRF-TOKEN` echo) for the current session, or undefined when not
   * connected. Read per-request so a session captured after construction takes
   * effect immediately. These never leave this client (Constitution 1.5).
   */
  private readonly authHeaders?: () => Record<string, string> | undefined;

  constructor(opts: {
    hostname: string;
    userAgent?: string;
    timeoutMs?: number;
    fetchFn?: FetchLike;
    authHeaders?: () => Record<string, string> | undefined;
  }) {
    this.base = `https://${opts.hostname}`;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.authHeaders = opts.authHeaders;
    this.headers = {
      "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-CA,en;q=0.9",
      Referer: `${this.base}/`,
    };
  }

  /** Per-request headers, adding the citizen's session auth when connected. */
  private requestHeaders(): Record<string, string> {
    const auth = this.authHeaders?.();
    return auth ? { ...this.headers, ...auth } : this.headers;
  }

  // -- low-level ------------------------------------------------------------

  private async get(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = new URL(this.base + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    let resp: Response;
    try {
      resp = await this.fetchFn(url.toString(), {
        headers: this.requestHeaders(),
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (exc) {
      throw new UpstreamError(
        `Could not reach the Parks Canada booking system (${String(exc)}).`,
      );
    }
    // Queue-it sends the browser to a *.queue-it.net waiting room.
    if (resp.url.includes("queue-it.net")) {
      throw new QueueItError(
        "Parks Canada is using a virtual waiting room right now. " +
          "Please try again shortly.",
      );
    }
    if (resp.status >= 400) {
      throw new UpstreamError(
        `The Parks Canada booking system returned an error ` +
          `(HTTP ${resp.status}) for ${path}.`,
      );
    }
    try {
      return await resp.json();
    } catch {
      throw new UpstreamError(
        `The Parks Canada booking system returned an unexpected ` +
          `response for ${path}.`,
      );
    }
  }

  /**
   * Authenticated POST with the citizen's session (Cookie + X-XSRF-TOKEN). Used
   * for state-changing actions the citizen has confirmed (profile update, and
   * later the booking cart). Never called without an explicit citizen go-ahead
   * at the tool layer (Constitution Art. 2).
   */
  private async post(path: string, body: unknown): Promise<unknown> {
    let resp: Response;
    try {
      resp = await this.fetchFn(this.base + path, {
        method: "POST",
        headers: { ...this.requestHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (exc) {
      throw new UpstreamError(
        `Could not reach the Parks Canada booking system (${String(exc)}).`,
      );
    }
    if (resp.url.includes("queue-it.net")) {
      throw new QueueItError(
        "Parks Canada is using a virtual waiting room right now. " +
          "Please try again shortly.",
      );
    }
    if (resp.status >= 400) {
      throw new UpstreamError(
        `The Parks Canada booking system returned an error ` +
          `(HTTP ${resp.status}) for ${path}.`,
      );
    }
    // A successful write may return JSON, or an empty body — both are fine.
    try {
      return await resp.json();
    } catch {
      return null;
    }
  }

  // -- endpoints ------------------------------------------------------------

  /** Reservable campgrounds: id, name, and root map id. */
  async listCampgrounds(): Promise<CampgroundRecord[]> {
    const data = (await this.get("/api/resourceLocation")) as
      | Array<Record<string, any>>
      | null;
    const out: CampgroundRecord[] = [];
    for (const facility of data ?? []) {
      const categories: number[] = facility["resourceCategoryIds"] ?? [];
      if (!categories.some((c) => CAMPSITE_CATEGORIES.has(c))) continue;
      out.push({
        resourceLocationId: facility["resourceLocationId"],
        name: (localized(facility["localizedValues"], "fullName") as string) ?? "",
        rootMapId: facility["rootMapId"],
      });
    }
    return out;
  }

  /** Equipment types: per-area `subEquipmentCategoryId` + name. */
  async listEquipmentTypes(): Promise<EquipmentRecord[]> {
    const data = (await this.get("/api/equipment")) as
      | Array<Record<string, any>>
      | null;
    const out: EquipmentRecord[] = [];
    for (const category of data ?? []) {
      for (const sub of category["subEquipmentCategories"] ?? []) {
        out.push({
          equipmentId: sub["subEquipmentCategoryId"],
          name: (localized(sub["localizedValues"], "name") as string) ?? "",
        });
      }
    }
    return out;
  }

  /** Resource collection for a campground, keyed by `resourceId`. */
  async getResources(
    resourceLocationId: number | string,
  ): Promise<Record<string, Record<string, any>>> {
    const data = (await this.get("/api/resourcelocation/resources", {
      resourceLocationId,
    })) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return Object.fromEntries(
        Object.entries(data as Record<string, any>).map(([k, v]) => [String(k), v]),
      );
    }
    const out: Record<string, Record<string, any>> = {};
    for (const r of (data as Array<Record<string, any>>) ?? []) {
      out[String(r["resourceId"])] = r;
    }
    return out;
  }

  /** Filterable attribute dictionary, keyed by attribute id (string). */
  async attributeDefinitions(): Promise<Record<string, any>> {
    const data = (await this.get("/api/attribute/filterable")) as unknown;
    return data && typeof data === "object" ? (data as Record<string, any>) : {};
  }

  /**
   * The signed-in citizen's account info (authenticated). Returns the JSON when
   * connected, or null when the call is unauthenticated/empty. Used to verify a
   * captured session is live.
   */
  async getUserInfo(): Promise<Record<string, any> | null> {
    const data = (await this.get("/api/account/userInfo")) as unknown;
    return data && typeof data === "object" ? (data as Record<string, any>) : null;
  }

  /** The signed-in citizen's reservations/bookings (authenticated). */
  async getMyBookings(): Promise<unknown> {
    return this.get("/api/shopper/allbookings");
  }

  /** The citizen's full shopper profile — phone, address, language, vehicles. */
  async getShopper(): Promise<Record<string, any> | null> {
    const data = (await this.get("/api/shopper")) as unknown;
    return data && typeof data === "object" ? (data as Record<string, any>) : null;
  }

  /**
   * Update the citizen's shopper profile. The caller passes the full profile
   * (read via getShopper, then modified) so server-managed fields are
   * preserved. State-changing — only after the citizen confirms (Art. 2).
   */
  async updateShopper(profile: Record<string, any>): Promise<unknown> {
    return this.post("/api/shopper", profile);
  }

  /**
   * Per-day availability for each site over the stay window. Walks the
   * campground's map tree (root → child maps); one request per map, never more
   * than the loop guard. Read-only.
   */
  async dailyAvailability(opts: {
    rootMapId: number | string;
    resourceLocationId: number | string;
    startDate: ISODate;
    endDate: ISODate;
    equipmentId?: number | null;
  }): Promise<DailyAvailability> {
    const result: DailyAvailability = {};
    const visited = new Set<string>();
    const toVisit: string[] = [String(opts.rootMapId)];
    let requests = 0;

    while (toVisit.length > 0) {
      const mapId = toVisit.pop()!;
      if (visited.has(mapId)) continue;
      visited.add(mapId);
      requests += 1;
      if (requests > MAX_MAP_REQUESTS) break;

      const data = (await this.get(
        "/api/availability/map",
        availabilityParams(
          mapId,
          opts.resourceLocationId,
          opts.startDate,
          opts.endDate,
          opts.equipmentId ?? null,
        ),
      )) as Record<string, any>;

      const resourceAvail = (data["resourceAvailabilities"] ?? {}) as Record<
        string,
        Array<{ availability?: number | null }> | null
      >;
      for (const [resourceId, slots] of Object.entries(resourceAvail)) {
        result[String(resourceId)] = (slots ?? []).map((s) => s?.availability ?? null);
      }
      for (const childMapId of Object.keys(data["mapLinkAvailabilities"] ?? {})) {
        if (!visited.has(String(childMapId))) toVisit.push(String(childMapId));
      }
    }
    return result;
  }

  /** Build the campground-level deep link the citizen opens to book. */
  buildBookingUrl(opts: {
    mapId: number | string;
    resourceLocationId: number | string;
    startDate: ISODate;
    endDate: ISODate;
    partySize: number;
    equipmentId?: number | null;
  }): string {
    const subEquipment = opts.equipmentId == null ? "" : opts.equipmentId;
    return (
      `${this.base}/create-booking/results` +
      `?mapId=${opts.mapId}` +
      "&bookingCategoryId=0" +
      `&startDate=${opts.startDate}` +
      `&endDate=${opts.endDate}` +
      "&isReserving=true" +
      `&equipmentId=${NON_GROUP_EQUIPMENT}` +
      `&subEquipmentId=${subEquipment}` +
      `&partySize=${opts.partySize}` +
      `&resourceLocationId=${opts.resourceLocationId}`
    );
  }

  /** Best-effort image fetch, restricted to this platform's own host (SSRF guard). */
  async fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    if (!url.startsWith("https://")) return null;
    if (!url.startsWith(this.base + "/")) return null;
    let resp: Response;
    try {
      resp = await this.fetchFn(url, {
        headers: this.requestHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return null;
    }
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return { bytes, contentType };
  }
}

function availabilityParams(
  mapId: number | string,
  resourceLocationId: number | string,
  startDate: ISODate,
  endDate: ISODate,
  equipmentId: number | null,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    mapId,
    resourceLocationId,
    bookingCategoryId: 0,
    equipmentCategoryId: NON_GROUP_EQUIPMENT,
    startDate,
    endDate,
    getDailyAvailability: "true",
    isReserving: "true",
    filterData: "[]",
    numEquipment: 1,
  };
  if (equipmentId != null) params["subEquipmentCategoryId"] = equipmentId;
  return params;
}

/** Return true if a resource record is marked accessible (attribute -32756 = 0). */
export function resourceIsAccessible(resource: Record<string, any>): boolean {
  for (const attribute of resource["definedAttributes"] ?? []) {
    if (attribute["attributeDefinitionId"] === ACCESSIBLE_ATTR) {
      let values: number[] | undefined = attribute["values"];
      if (values == null && attribute["value"] != null) values = [attribute["value"]];
        return (values ?? []).includes(0);
    }
  }
  return false;
}
