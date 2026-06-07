/**
 * Parks Canada provider, via the GoingToCamp platform. Maps the verified API
 * (docs/parks-canada-api-findings.md) into the normalized shapes in `types.ts`.
 * Accessibility is first-class and filterable (Constitution Art. 3).
 */
import {
  BACKCOUNTRY_EQUIPMENT_CATEGORY,
  BOOKING_CATEGORY_ID,
  BOOKING_GROUP,
  bookingGroupForCategory,
  CATEGORY_GROUPS,
  PARKS_CANADA_HOSTNAME,
  PARKS_CANADA_NAME,
  PARKS_CANADA_REC_AREA_ID,
  SERVICE_TYPE_ATTR,
  type BookingGroup,
  type CategoryGroup,
} from "./constants.js";
import {
  GoingToCampClient,
  resourceIsAccessible,
  type BookingCategoryRecord,
  type CampgroundRecord,
  type EquipmentRecord,
  type FetchLike,
  type ResourceCategoryInfo,
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
  BackcountryProduct,
  BackcountryZone,
  CampgroundAvailability,
  DayUseProduct,
  DayUseSlot,
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
  /** Which kind of stay: frontcountry campsites (default), group sites, or roofed
   *  accommodations (oTENTik, cabin, yurt, …). Filters results by resource category. */
  category?: CategoryGroup;
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
  category?: CategoryGroup;
}

export class ParksCanadaProvider {
  static readonly providerName = PROVIDER_NAME;

  private readonly client: GoingToCampClient;
  private campgroundsCache?: CampgroundRecord[];
  private attrDefsCache?: Record<string, any>;
  private equipmentCache?: EquipmentRecord[];
  private resourceCategoriesCache?: Map<number, ResourceCategoryInfo>;
  private bookingCategoriesCache?: BookingCategoryRecord[];
  private facilitiesCache?: CampgroundRecord[];

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
    const campgrounds = await Promise.all(
      matched.map(async (c) => ({
        provider: PROVIDER_NAME,
        recreationAreaId: PARKS_CANADA_REC_AREA_ID,
        campgroundId: String(c.resourceLocationId),
        name: c.name,
        offers: await this.offeredGroups(c.offeredCategoryIds),
      })),
    );
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

  /**
   * Search Day Use (model 1) products — shuttles, parking, guided events — for open
   * timed slots. Matches the query against product names, then returns each slot
   * (e.g. "Moraine Lake: 6:30am-7am") with the spots left on each requested day.
   */
  async searchDayUse(opts: {
    query: string;
    startDate: ISODate;
    endDate: ISODate;
    partySize?: number;
  }): Promise<DayUseSlot[]> {
    const need = Math.max(1, opts.partySize ?? 1);
    const matched = await this.dayUseProducts(opts.query);

    const slots: DayUseSlot[] = [];
    for (const product of matched) {
      const resources = await this.client.getResources(String(product.resourceLocationId));
      // Public, bookable slots only — exclude staff/media/"Park Use" internal holds.
      const entries = Object.values(resources).filter((r: any) => {
        const name = resourceName(r) ?? "";
        return !/\(park use\)/i.test(name);
      });
      const byId = new Map(entries.map((r: any) => [String(r["resourceId"]), r]));
      if (byId.size === 0) continue;
      const avail = await this.client.dayUseAvailability({
        resourceLocationId: product.resourceLocationId,
        resourceIds: [...byId.keys()],
        startDate: opts.startDate,
        endDate: opts.endDate,
        bookingCategoryId: product.bookingCategoryId,
      });
      for (const a of avail) {
        if (a.remainingQuota < need) continue;
        const resource = byId.get(a.resourceId);
        if (!resource) continue;
        slots.push({
          provider: PROVIDER_NAME,
          recreationAreaId: PARKS_CANADA_REC_AREA_ID,
          productId: String(product.bookingCategoryId),
          product: product.name,
          campgroundId: String(product.resourceLocationId),
          slotId: a.resourceId,
          slotName: resourceName(resource) ?? a.resourceId,
          date: a.date,
          remaining: a.remainingQuota,
        });
      }
    }
    slots.sort(
      (x, y) =>
        x.product.localeCompare(y.product) ||
        x.date.localeCompare(y.date) ||
        compareSiteNames(x.slotName, y.slotName),
    );
    return slots;
  }

  /** Day Use products (bookingModel 1), optionally narrowed to a name/place query. */
  private async dayUseProducts(query?: string): Promise<BookingCategoryRecord[]> {
    const products = (await this.bookingCategories()).filter((p) => p.bookingModel === 1);
    const words = (query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    if (words.length === 0) return products;
    return products.filter((p) => {
      const name = p.name.toLowerCase();
      return words.some((w) => name.includes(w));
    });
  }

  /** Browse the Day Use catalog — the products a citizen can pick (shuttles, parking,
   *  guided events, …), optionally filtered by name/place. No dates needed. */
  async listDayUseProducts(query?: string): Promise<DayUseProduct[]> {
    return (await this.dayUseProducts(query))
      .map((p) => ({
        provider: PROVIDER_NAME,
        recreationAreaId: PARKS_CANADA_REC_AREA_ID,
        productId: String(p.bookingCategoryId),
        product: p.name,
        campgroundId: String(p.resourceLocationId),
      }))
      .sort((a, b) => a.product.localeCompare(b.product));
  }

  private async bookingCategories(): Promise<BookingCategoryRecord[]> {
    if (!this.bookingCategoriesCache) {
      this.bookingCategoriesCache = await this.client.listBookingCategories();
    }
    return this.bookingCategoriesCache;
  }

  /** Root map id for ANY facility (including backcountry/day-use, which aren't in
   *  the site-filtered campground list). */
  private async facilityRootMapId(rlid: string): Promise<number | string | null> {
    if (!this.facilitiesCache) this.facilitiesCache = await this.client.listFacilities();
    const f = this.facilitiesCache.find((x) => String(x.resourceLocationId) === String(rlid));
    return f ? f.rootMapId : null;
  }

  /** Backcountry products (bookingModel 5), optionally narrowed by name/place. */
  private async backcountryProducts(query?: string): Promise<BookingCategoryRecord[]> {
    const products = (await this.bookingCategories()).filter((p) => p.bookingModel === 5);
    const words = (query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    if (words.length === 0) return products;
    return products.filter((p) => {
      const name = p.name.toLowerCase();
      return words.some((w) => name.includes(w));
    });
  }

  /** Browse the backcountry catalog — the areas/trips a citizen can pick. */
  async listBackcountryProducts(query?: string): Promise<BackcountryProduct[]> {
    return (await this.backcountryProducts(query))
      .map((p) => ({
        provider: PROVIDER_NAME,
        recreationAreaId: PARKS_CANADA_REC_AREA_ID,
        productId: String(p.bookingCategoryId),
        product: p.name,
        campgroundId: String(p.resourceLocationId),
      }))
      .sort((a, b) => a.product.localeCompare(b.product));
  }

  /**
   * Search backcountry (model 5) zones for nights with room for the party. Each zone
   * is one itinerary leg (one zone per night); availability is a per-night quota, so
   * a night is "open" when the remaining count is at least the party size. A trip is
   * composed from these zones via prepare_booking's itinerary. Accessibility, where
   * the zone exposes it, is surfaced first-class (Constitution Art. 3).
   */
  async searchBackcountry(opts: {
    query: string;
    startDate: ISODate;
    endDate: ISODate;
    partySize?: number;
    accessibleOnly?: boolean;
  }): Promise<BackcountryZone[]> {
    const need = Math.max(1, opts.partySize ?? 1);
    const matched = await this.backcountryProducts(opts.query);
    const window = windowNights(opts.startDate, opts.endDate);

    const zones: BackcountryZone[] = [];
    for (const product of matched) {
      const rlid = String(product.resourceLocationId);
      // Backcountry facilities aren't in the (site-filtered) campground list, so
      // resolve their root map from the unfiltered facility list.
      const rootMapId = await this.facilityRootMapId(rlid);
      if (rootMapId == null) continue;
      const resources = await this.client.getResources(rlid);
      const daily = await this.client.dailyAvailability({
        rootMapId,
        resourceLocationId: rlid,
        startDate: opts.startDate,
        endDate: opts.endDate,
        bookingCategoryId: product.bookingCategoryId,
        equipmentCategoryId: BACKCOUNTRY_EQUIPMENT_CATEGORY,
      });
      for (const [zoneId, counts] of Object.entries(daily)) {
        const resource = resources[zoneId];
        if (!resource) continue;
        // Backcountry availability is a remaining-quota count per night (not a
        // status code): a night has room when at least the whole party fits.
        const open: ISODate[] = [];
        let minRemaining = Infinity;
        window.forEach((night, i) => {
          const q = counts[i];
          if (q != null && q >= need) {
            open.push(night);
            minRemaining = Math.min(minRemaining, q);
          }
        });
        if (open.length === 0) continue;
        const accessible = resourceIsAccessible(resource);
        if (opts.accessibleOnly && !accessible) continue;
        zones.push({
          provider: PROVIDER_NAME,
          recreationAreaId: PARKS_CANADA_REC_AREA_ID,
          productId: String(product.bookingCategoryId),
          product: product.name,
          campgroundId: rlid,
          zoneId,
          zoneName: resourceName(resource) ?? zoneId,
          accessible,
          openNights: open,
          minRemaining: minRemaining === Infinity ? 0 : minRemaining,
        });
      }
    }
    zones.sort(
      (a, b) =>
        (a.accessible ? 0 : 1) - (b.accessible ? 0 : 1) ||
        a.product.localeCompare(b.product) ||
        compareSiteNames(a.zoneName, b.zoneName),
    );
    return zones;
  }

  async searchSites(opts: SearchSitesOptions): Promise<AvailableSite[]> {
    const rootMapId = await this.rootMapId(opts.campgroundId);
    if (rootMapId == null) {
      throw new UpstreamError(
        `Could not find a Parks Canada campground with id ${opts.campgroundId}.`,
      );
    }
    const group = opts.category ?? "campsite";
    const equipmentId = await this.resolveEquipmentId(opts.equipmentType);
    const resources = await this.client.getResources(opts.campgroundId);
    const daily = await this.client.dailyAvailability({
      rootMapId,
      resourceLocationId: opts.campgroundId,
      startDate: opts.startDate,
      endDate: opts.endDate,
      equipmentId,
      bookingCategoryId: BOOKING_CATEGORY_ID[group],
    });
    const window = windowNights(opts.startDate, opts.endDate);
    const campgroundName = await this.campgroundName(opts.campgroundId);
    const defs = await this.attrDefs();
    // Keep only the kind of stay asked for (campsites by default); each resource
    // carries a resourceCategoryId that tells campsite vs group vs accommodation.
    const wantCategories = CATEGORY_GROUPS[group];
    const categoryNames = await this.resourceCategories();
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
      const categoryId = resource["resourceCategoryId"] as number | undefined;
      if (categoryId == null || !wantCategories.has(categoryId)) continue;
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
        siteType: categoryNames.get(categoryId)?.name ?? serviceTypeLabel(resource, defs),
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
          category: opts.category,
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

  /** Read a cart back, to confirm a booking actually landed in it. */
  getCart(cartUid: string, cartTransactionUid: string): Promise<Record<string, any> | null> {
    return this.client.getCart(cartUid, cartTransactionUid);
  }

  /**
   * Resolve a citizen's equipment word or id to the platform's equipment id, for
   * booking. Throws InvalidInputError (naming the options) for an ambiguous or
   * unknown word; `null`/empty → no specific equipment (caller picks a default).
   */
  resolveEquipment(equipmentType?: string | null): Promise<number | null> {
    return this.resolveEquipmentId(equipmentType);
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

  /** Cached resourceCategoryId → {name, resourceType} (Campsite, oTENTik, Cabin, …). */
  private async resourceCategories(): Promise<Map<number, ResourceCategoryInfo>> {
    if (!this.resourceCategoriesCache) {
      this.resourceCategoriesCache = await this.client.listResourceCategories();
    }
    return this.resourceCategoriesCache;
  }

  /** The distinct booking groups a campground offers (Frontcountry Camping,
   *  Accommodations, Backcountry, Day Use), grounded in its resource categories. */
  private async offeredGroups(offeredCategoryIds: number[]): Promise<BookingGroup[]> {
    const cats = await this.resourceCategories();
    const groups = new Set<BookingGroup>();
    for (const id of offeredCategoryIds) {
      const g = bookingGroupForCategory(id, cats.get(id)?.resourceType);
      if (g) groups.add(g);
    }
    // Stable, user-facing order.
    const order = [
      BOOKING_GROUP.frontcountry,
      BOOKING_GROUP.accommodation,
      BOOKING_GROUP.backcountry,
      BOOKING_GROUP.dayUse,
    ];
    return order.filter((g) => groups.has(g));
  }

  /** Booking groups a single campground offers, by id (for empty-result hints). */
  async campgroundOfferings(campgroundId: string): Promise<BookingGroup[]> {
    const cg = (await this.campgrounds()).find(
      (c) => String(c.resourceLocationId) === String(campgroundId),
    );
    return cg ? this.offeredGroups(cg.offeredCategoryIds) : [];
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
