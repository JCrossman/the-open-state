/**
 * Parks Canada provider, via the GoingToCamp platform. Maps the verified API
 * (docs/parks-canada-api-findings.md) into the normalized shapes in `types.ts`.
 * Accessibility is first-class and filterable (Constitution Art. 3).
 */
import {
  PARKS_CANADA_HOSTNAME,
  PARKS_CANADA_NAME,
  PARKS_CANADA_REC_AREA_ID,
  SERVICE_TYPE_ATTR,
} from "./constants.js";
import {
  GoingToCampClient,
  resourceIsAccessible,
  type CampgroundRecord,
  type EquipmentRecord,
  type FetchLike,
} from "./client.js";
import { InvalidInputError, UpstreamError } from "./errors.js";
import {
  compareSiteNames,
  evaluateStay,
  openNights,
  windowNights,
} from "./availability.js";
import { localized } from "./util.js";
import type {
  AvailableSite,
  CampgroundAvailability,
  EquipmentType,
  ISODate,
  RecreationArea,
  SiteDetails,
} from "./types.js";

const PROVIDER_NAME = "parks_canada";

export interface SearchSitesOptions {
  recreationAreaId?: string;
  campgroundId: string;
  startDate: ISODate;
  endDate: ISODate;
  partySize: number;
  equipmentType?: string | null;
  accessibleOnly?: boolean;
  nights?: number | null;
  weekendsOnly?: boolean;
}

export interface SearchParkAvailabilityOptions {
  query: string;
  startDate: ISODate;
  endDate: ISODate;
  partySize: number;
  equipmentType?: string | null;
  accessibleOnly?: boolean;
  nights?: number | null;
  weekendsOnly?: boolean;
}

export class ParksCanadaProvider {
  static readonly providerName = PROVIDER_NAME;

  private readonly client: GoingToCampClient;
  private campgroundsCache?: CampgroundRecord[];
  private attrDefsCache?: Record<string, any>;
  private equipmentCache?: EquipmentRecord[];

  constructor(
    opts: {
      client?: GoingToCampClient;
      userAgent?: string;
      timeoutMs?: number;
      fetchFn?: FetchLike;
      authHeaders?: () => Record<string, string> | undefined;
    } = {},
  ) {
    this.client =
      opts.client ??
      new GoingToCampClient({
        hostname: PARKS_CANADA_HOSTNAME,
        userAgent: opts.userAgent,
        timeoutMs: opts.timeoutMs,
        fetchFn: opts.fetchFn,
        authHeaders: opts.authHeaders,
      });
  }

  // -- interface ------------------------------------------------------------

  async searchParks(query: string, country = "CA"): Promise<RecreationArea[]> {
    if (country.toUpperCase() !== "CA") return [];
    const needle = query.toLowerCase();
    const matched = (await this.campgrounds()).filter((c) =>
      (c.name ?? "").toLowerCase().includes(needle),
    );
    if (matched.length === 0) return [];
    const campgrounds = matched.map((c) => ({
      provider: PROVIDER_NAME,
      recreationAreaId: PARKS_CANADA_REC_AREA_ID,
      campgroundId: String(c.resourceLocationId),
      name: c.name,
    }));
    return [
      {
        provider: PROVIDER_NAME,
        recreationAreaId: PARKS_CANADA_REC_AREA_ID,
        name: PARKS_CANADA_NAME,
        campgrounds,
      },
    ];
  }

  async listEquipmentTypes(recreationAreaId: string): Promise<EquipmentType[]> {
    return (await this.equipment()).map((e) => ({
      provider: PROVIDER_NAME,
      recreationAreaId: String(recreationAreaId),
      equipmentId: String(e.equipmentId),
      name: e.name ?? "",
    }));
  }

  async searchSites(opts: SearchSitesOptions): Promise<AvailableSite[]> {
    const rootMapId = await this.rootMapId(opts.campgroundId);
    if (rootMapId == null) {
      throw new UpstreamError(
        `Could not find a Parks Canada campground with id ${opts.campgroundId}.`,
      );
    }
    const equipmentId = await this.resolveEquipmentId(opts.equipmentType);
    const resources = await this.client.getResources(opts.campgroundId);
    const daily = await this.client.dailyAvailability({
      rootMapId,
      resourceLocationId: opts.campgroundId,
      startDate: opts.startDate,
      endDate: opts.endDate,
      equipmentId,
    });
    const window = windowNights(opts.startDate, opts.endDate);
    const campgroundName = await this.campgroundName(opts.campgroundId);
    const defs = await this.attrDefs();
    const bookingUrl = this.client.buildBookingUrl({
      mapId: rootMapId,
      resourceLocationId: opts.campgroundId,
      startDate: opts.startDate,
      endDate: opts.endDate,
      partySize: opts.partySize,
      equipmentId,
    });

    const sites: AvailableSite[] = [];
    for (const [resourceId, dayCodes] of Object.entries(daily)) {
      const resource = resources[resourceId];
      if (!resource) continue;
      const { qualifies, dates } = evaluateStay(
        openNights(window, dayCodes),
        window,
        opts.nights ?? null,
        opts.weekendsOnly ?? false,
      );
      if (!qualifies) continue;
      const accessible = resourceIsAccessible(resource);
      if (opts.accessibleOnly && !accessible) continue;
      const maxOccupancy = resource["maxCapacity"] as number | undefined;
      if (opts.partySize && maxOccupancy != null && maxOccupancy < opts.partySize) {
        continue;
      }
      sites.push({
        provider: PROVIDER_NAME,
        recreationArea: PARKS_CANADA_NAME,
        recreationAreaId: PARKS_CANADA_REC_AREA_ID,
        campground: campgroundName,
        campgroundId: String(opts.campgroundId),
        campsiteId: resourceId,
        siteName: resourceName(resource) ?? resourceId,
        accessible,
        availableDates: dates,
        siteType: serviceTypeLabel(resource, defs),
        maxOccupancy: maxOccupancy ?? undefined,
        bookingUrl,
      });
    }
    sites.sort(
      (a, b) =>
        (a.accessible ? 0 : 1) - (b.accessible ? 0 : 1) ||
        compareSiteNames(a.siteName, b.siteName),
    );
    return sites;
  }

  async searchParkAvailability(
    opts: SearchParkAvailabilityOptions,
  ): Promise<CampgroundAvailability[]> {
    // Resolve once up front: a bad equipment type is a problem with the request,
    // not with any one campground, so fail fast rather than "could not check" on
    // every row.
    await this.resolveEquipmentId(opts.equipmentType);
    const areas = await this.searchParks(opts.query);
    const campgrounds = areas.length > 0 ? areas[0]!.campgrounds : [];
    const results: CampgroundAvailability[] = [];
    for (const cg of campgrounds) {
      try {
        const sites = await this.searchSites({
          recreationAreaId: cg.recreationAreaId,
          campgroundId: cg.campgroundId,
          startDate: opts.startDate,
          endDate: opts.endDate,
          partySize: opts.partySize,
          equipmentType: opts.equipmentType,
          accessibleOnly: opts.accessibleOnly,
          nights: opts.nights,
          weekendsOnly: opts.weekendsOnly,
        });
        results.push({
          provider: PROVIDER_NAME,
          recreationAreaId: cg.recreationAreaId,
          campgroundId: cg.campgroundId,
          campgroundName: cg.name,
          openSiteCount: sites.length,
          accessibleCount: sites.filter((s) => s.accessible).length,
        });
      } catch (exc) {
        results.push({
          provider: PROVIDER_NAME,
          recreationAreaId: cg.recreationAreaId,
          campgroundId: cg.campgroundId,
          campgroundName: cg.name,
          openSiteCount: 0,
          accessibleCount: 0,
          error: exc instanceof Error ? exc.message : String(exc),
        });
      }
    }
    // Most open sites first; campgrounds with nothing fall to the bottom.
    results.sort(
      (a, b) =>
        (a.error ? 1 : 0) - (b.error ? 1 : 0) || b.openSiteCount - a.openSiteCount,
    );
    return results;
  }

  async siteDetails(opts: {
    recreationAreaId?: string;
    campgroundId: string;
    campsiteId: string;
  }): Promise<SiteDetails> {
    const resources = await this.client.getResources(opts.campgroundId);
    const resource = resources[String(opts.campsiteId)];
    if (!resource) {
      throw new UpstreamError(
        `Could not find campsite ${opts.campsiteId} in campground ${opts.campgroundId}.`,
      );
    }
    const defs = await this.attrDefs();
    const accessible = resourceIsAccessible(resource);
    const notes: string[] = [];
    if (accessible) notes.push("Parks Canada marks this site as accessible.");
    const serviceLabel = serviceTypeLabel(resource, defs);
    if (serviceLabel) notes.push(`Service type: ${serviceLabel}.`);
    return {
      provider: PROVIDER_NAME,
      recreationAreaId: String(opts.recreationAreaId ?? PARKS_CANADA_REC_AREA_ID),
      campsiteId: String(opts.campsiteId),
      siteName: resourceName(resource) ?? String(opts.campsiteId),
      accessible,
      amenities: amenities(resource, defs),
      accessibilityNotes: notes,
      photos: photos(resource),
      maxOccupancy: (resource["maxCapacity"] as number | undefined) ?? undefined,
      siteType: serviceLabel,
    };
  }

  fetchPhoto(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    return this.client.fetchImage(url);
  }

  /** The signed-in citizen's account info, to verify a captured session. */
  getUserInfo(): Promise<Record<string, any> | null> {
    return this.client.getUserInfo();
  }

  /** The signed-in citizen's reservations/bookings. */
  getMyBookings(): Promise<unknown> {
    return this.client.getMyBookings();
  }

  /** The citizen's full shopper profile (phone, address, etc.). */
  getShopper(): Promise<Record<string, any> | null> {
    return this.client.getShopper();
  }

  /** Update the citizen's profile (after they confirm). */
  updateShopper(profile: Record<string, any>): Promise<unknown> {
    return this.client.updateShopper(profile);
  }

  /** The raw GET /api/shopper envelope, needed to assemble a booking cart. */
  getShopperEnvelope(): Promise<Record<string, any> | null> {
    return this.client.getShopperEnvelope();
  }

  /** Get a fresh cart (server-issued cartUid) to begin a booking. */
  getNewCart(): Promise<Record<string, any>> {
    return this.client.getNewCart();
  }

  /** Start a server-issued cart transaction (the real cart skeleton to book into). */
  newCartTransaction(cartUid: string): Promise<Record<string, any>> {
    return this.client.newCartTransaction(cartUid);
  }

  /** Commit a booking cart (after the citizen confirms; never past payment). */
  commitCart(
    cart: { cart: Record<string, any> },
    opts: { isCompleted?: boolean; isSelfCheckIn?: boolean } = {},
  ): Promise<unknown> {
    return this.client.commitCart(cart, opts);
  }

  async bookingUrl(opts: {
    campgroundId: string;
    startDate: ISODate;
    endDate: ISODate;
    partySize: number;
    equipmentType?: string | null;
  }): Promise<string> {
    const rootMapId = await this.rootMapId(opts.campgroundId);
    if (rootMapId == null) {
      throw new UpstreamError(
        `Could not find a Parks Canada campground with id ${opts.campgroundId}.`,
      );
    }
    const equipmentId = await this.resolveEquipmentId(opts.equipmentType);
    return this.client.buildBookingUrl({
      mapId: rootMapId,
      resourceLocationId: opts.campgroundId,
      startDate: opts.startDate,
      endDate: opts.endDate,
      partySize: opts.partySize,
      equipmentId,
    });
  }

  // -- helpers --------------------------------------------------------------

  private async campgrounds(): Promise<CampgroundRecord[]> {
    if (!this.campgroundsCache) {
      this.campgroundsCache = await this.client.listCampgrounds();
    }
    return this.campgroundsCache;
  }

  private async equipment(): Promise<EquipmentRecord[]> {
    if (!this.equipmentCache) {
      this.equipmentCache = await this.client.listEquipmentTypes();
    }
    return this.equipmentCache;
  }

  private async attrDefs(): Promise<Record<string, any>> {
    if (!this.attrDefsCache) {
      this.attrDefsCache = await this.client.attributeDefinitions();
    }
    return this.attrDefsCache;
  }

  private async findCampground(
    campgroundId: string,
  ): Promise<CampgroundRecord | undefined> {
    const target = String(campgroundId);
    return (await this.campgrounds()).find(
      (c) => String(c.resourceLocationId) === target,
    );
  }

  private async rootMapId(campgroundId: string): Promise<number | string | null> {
    const c = await this.findCampground(campgroundId);
    return c ? c.rootMapId : null;
  }

  private async campgroundName(campgroundId: string): Promise<string> {
    const c = await this.findCampground(campgroundId);
    return c?.name || String(campgroundId);
  }

  /**
   * Turn a citizen's equipment word or id into the platform's id. A word that
   * matches several types, or none, raises `InvalidInputError` naming the
   * options rather than guessing (Constitution Art. 7.1). `null`/empty → no filter.
   */
  private async resolveEquipmentId(
    equipmentType?: string | null,
  ): Promise<number | null> {
    if (equipmentType == null) return null;
    const text = equipmentType.trim();
    if (!text) return null;
    const equipment = await this.equipment();

    if (/^-?\d+$/.test(text)) {
      const asId = parseInt(text, 10);
      const known = new Set(equipment.map((e) => e.equipmentId));
      if (known.size === 0 || known.has(asId)) return asId;
      throw new InvalidInputError(
        `'${equipmentType}' is not a known equipment id. ` +
          equipmentOptions(equipment),
      );
    }

    const needle = text.toLowerCase();
    const matches = equipment.filter((e) => {
      const name = (e.name ?? "").toLowerCase();
      return name.includes(needle) || needle.includes(name);
    });
    if (matches.length === 1) return matches[0]!.equipmentId;
    if (matches.length === 0) {
      throw new InvalidInputError(
        `I do not recognize the equipment '${equipmentType}'. ` +
          equipmentOptions(equipment),
      );
    }
    throw new InvalidInputError(
      `'${equipmentType}' matches several equipment types - tell me which ` +
        `one (by id). ` +
        equipmentOptions(matches),
    );
  }
}

// -- module-level pure helpers ------------------------------------------------

function equipmentOptions(equipment: EquipmentRecord[]): string {
  if (equipment.length === 0) {
    return "Use list_equipment_types to see the valid equipment ids.";
  }
  const listed = equipment
    .map((e) => `${e.name || "equipment"} (${e.equipmentId})`)
    .join(", ");
  return `Valid options are: ${listed}.`;
}

function resourceName(resource: Record<string, any>): string | undefined {
  return localized(resource["localizedValues"], "name") as string | undefined;
}

function photos(resource: Record<string, any>): string[] {
  const urls: string[] = [];
  for (const photo of resource["photos"] ?? []) {
    const result = (photo ?? {})["photoUrlResult"] ?? {};
    const url = result["url"] ?? result["avifUrl"];
    if (url) urls.push(url);
  }
  return urls;
}

function attrValues(resource: Record<string, any>, attributeId: number): number[] {
  for (const attribute of resource["definedAttributes"] ?? []) {
    if (attribute["attributeDefinitionId"] === attributeId) {
      let values: number[] | undefined = attribute["values"];
      if (values == null && attribute["value"] != null) values = [attribute["value"]];
      return values ?? [];
    }
  }
  return [];
}

function displayName(definition: Record<string, any>): string | undefined {
  return localized(definition["localizedValues"], "displayName") as string | undefined;
}

function enumLabelsFromDef(definition: Record<string, any>): Map<number, string> {
  const labels = new Map<number, string>();
  for (const value of definition["values"] ?? []) {
    const enumValue = value["enumValue"];
    if (enumValue != null) {
      labels.set(enumValue, localized(value["localizedValues"], "displayName") as string);
    }
  }
  return labels;
}

function enumLabels(
  defs: Record<string, any>,
  attributeId: number,
): Map<number, string> {
  const definition = defs[String(attributeId)];
  return definition ? enumLabelsFromDef(definition) : new Map();
}

function serviceTypeLabel(
  resource: Record<string, any>,
  defs: Record<string, any>,
): string | undefined {
  const labels = enumLabels(defs, SERVICE_TYPE_ATTR);
  for (const value of attrValues(resource, SERVICE_TYPE_ATTR)) {
    const label = labels.get(value);
    if (label) return label;
  }
  return undefined;
}

function amenities(
  resource: Record<string, any>,
  defs: Record<string, any>,
): string[] {
  const out: string[] = [];
  for (const attribute of resource["definedAttributes"] ?? []) {
    const definition = defs[String(attribute["attributeDefinitionId"])];
    if (!definition) continue;
    const name = displayName(definition);
    if (!name) continue;
    const labelMap = enumLabelsFromDef(definition);
    let values: any[] | undefined = attribute["values"];
    if (values == null && attribute["value"] != null) values = [attribute["value"]];
    const labels = (values ?? [])
      .map((v) => String(labelMap.get(v) ?? v))
      .filter((label) => label);
    if (labels.length > 0) out.push(`${name}: ${labels.join(", ")}`);
  }
  return out;
}
