# Parks Canada (GoingToCamp) API — verified findings

Status: **verification record** produced during M1 step 2 ("verify first").
Date captured: 2026-05-29. Host: `reservation.pc.gc.ca` (Parks Canada, camply
`recreation_area_id = 14`).

This documents what the **live** Parks Canada API actually does today, versus
what camply (0.34.2) and the M1 spec assume. Where the two disagree, reality is
recorded here and wins (per AGENTS.md). Each item is marked **[verified live]**,
**[from SPA bundle]**, or **[assumed / to confirm]** so we never claim certainty
we don't have (Constitution Art. 7.1).

## Access conditions

- Requests need browser-like headers (`User-Agent`, `Accept-Language`,
  `Referer: https://reservation.pc.gc.ca/`). Minimal headers → **HTTP 403**.
  [verified live]
- A **Queue-it** virtual waiting room is wired into the site
  (`queue-it-init.js`). It is not engaged off-peak but will gate traffic on
  launch days; the provider must detect a queue response and surface it as a
  plain-language status, never try to defeat it. [from SPA bundle]
- All data endpoints observed are **GET** (no auth) for read/search. Booking
  itself happens in the citizen's own browser session — we never touch it.

## Endpoints (current)

Base: `https://reservation.pc.gc.ca`

| Endpoint | Use | Status |
|---|---|---|
| `GET /api/equipment` | equipment categories → `[0].subEquipmentCategories[].{subEquipmentCategoryId, localizedValues[].name}` | [verified live] |
| `GET /api/resourceLocation` | all campgrounds: `{resourceLocationId, localizedValues[].fullName, resourceCategoryIds, rootMapId, region, gpsCoordinates}` (114 entries) | [verified live] |
| `GET /api/maps?resourceLocationId=<id>` | maps for one campground; each map: `{mapId, resourceLocationId, mapResources[], mapLinks[], parentMap, mapLegendItems[]}` | [verified live] |
| `GET /api/availability/map?...` | availability (see below) | [verified live] |
| `GET /api/attribute/filterable` | filterable attribute definitions, keyed by `attributeDefinitionId` | [verified live] |
| `GET /api/attribute/getById?attributeId=<id>` | one attribute definition | [from SPA bundle] |
| `GET /api/maps/root`, `/api/maps/legendicons`, `/api/mapLegendResourceIconLabel` | map + legend rendering | [from SPA bundle] |
| `GET /api/reachableresources/resourcelocationid?resourceLocationId=<id>` | returned `{}` for our test campground | [verified live — empty] |
| `GET /api/occupancy`, `/api/capacitycategory/capacitycategories`, `/api/dateschedule/resourcelocationid`, `/api/bookingcategories` | not yet explored | [from SPA bundle] |

### Availability

`GET /api/availability/map` with query params:
`mapId, resourceLocationId, bookingCategoryId=0, equipmentCategoryId=-32768,
subEquipmentCategoryId=<equip or omit>, partySize, startDate=<ISO>,
endDate=<ISO>, getDailyAvailability=false, isReserving=true, numEquipment=1`
and a `filterData` field (default `null`). [verified live + from SPA bundle]

Response:
```
{ "mapId", "mapAvailabilities",
  "resourceAvailabilities": { "<resourceId>": [ {"availability": int, "remainingQuota": ...} ] },
  "mapLinkAvailabilities":  { "<childMapId>": ... } }
```
- **`availability == 0` means AVAILABLE.** Other values = unavailable. [verified live]
- The campground's root map is a parent; real sites live in **child maps** —
  recurse into each key of `mapLinkAvailabilities` and query again with that
  `mapId`. [verified live]

### Key constants

- `equipmentCategoryId` non-group = **-32768**.
- Resource categories: CAMP_SITE **-2147483648**, OVERFLOW **-2147483647**, GROUP **-2147483643**.
- **Accessible** attribute: `attributeDefinitionId = -32756`, enum `0 = Yes`, `1 = No`. [verified live]
- Service Type attribute: `-32768` (different namespace from equipment); some enum
  values are themselves "Accessible, …". [verified live]

### Campground → map linkage

`resourceLocation[i].rootMapId` is that campground's top map; `mapLinks[].{resourceLocationId, childMapId}`
connect parent→child maps. (Camply's assumption that `/api/maps` entries carry
`resourceLocationId` does **not** hold on this host — they are `null`.) [verified live]

### Booking deep link (prepare-then-confirm, campground-level)

```
https://reservation.pc.gc.ca/create-booking/results?mapId=<mapId>&bookingCategoryId=0
  &startDate=<ISO>&endDate=<ISO>&isReserving=true
  &equipmentId=-32768&subEquipmentId=<equip or "">&partySize=<n>&resourceLocationId=<rlid>
```
The link prefills the **campground + dates + party + equipment**; the citizen
picks the exact site and confirms in their own session. It is not per-site.
[constructed from camply `get_reservation_link` + verified params; not click-tested]

## Divergences from camply (camply 0.34.2 is stale for this host)

1. **`/api/resource/details` is GONE → HTTP 404.** This was camply's *only* source
   of per-site **name, capacity, and accessibility attributes**. Camply's
   `get_all_campsites` calls it for every available site, so **camply is currently
   broken for Parks Canada** (it would raise on any non-empty search). This is an
   upstream removal, independent of our wrap-vs-reimplement choice. [verified live]
2. `/api/maps` is keyed by `resourceLocationId`, not `mapId`. [verified live]
3. Capacity fields are now `peopleCapacity` / `equipmentCapacity`, not
   `minCapacity` / `maxCapacity`. [from SPA bundle]
4. `mapResources` are **placements only** (`resourceId`, `iconType`, coordinates) —
   no names, no attributes, no capacity. `mapLabels` was empty for the test
   campground. [verified live]

## What the API exposes today vs. what M1 / `AvailableSite` assume

**Reliably obtainable:**
- Per-campground availability for dates / equipment / party size (which
  `resourceId`s are open, and how many). [verified]
- **Accessible-only filtering** via `filterData` on `/api/availability/map`
  (attribute `-32756`) — satisfies Constitution Art. 3.3 "filterable". Exact
  `filterData` JSON shape still **[to confirm]**.
- A prepared, campground-level booking deep link. [verified params]

**Not exposed by any endpoint mapped so far:**
- Per-site human-readable **name** (sites are map pins identified by position).
- Per-site **price**.
- Per-site **capacity** (per-resource).
- A per-site **accessibility flag for display** (accessibility is available as a
  *filter*, from which the accessible subset of `resourceId`s can be derived,
  rather than a per-site readable attribute).

This means `AvailableSite.site_name`, `.price`, `.max_occupancy`, and a per-site
`.accessible` cannot be populated from upstream the way the M1 spec assumed.

## Deep-dig results (follow-up investigation)

After mining the full SPA bundle and probing the remaining endpoints live:

- **Site names: not exposed.** The client keeps a resource store keyed
  `resourceLocationId → {resourceId: {localizedValues…}}`, but the only endpoint
  that could populate it, `GET /api/reachableresources/resourcelocationid`,
  returned `{}` for **every** campground tested (`-2147483643/44/45/46`).
  `mapResources` carry no names; `mapLabels` were empty; the old details endpoint
  is gone. `GET /api/dateschedule/resourcelocationid` gives only a loop-level name
  ("Campsites (Tunnel Mountain Trailer Court)") and season windows. [verified live]
- **Price: not exposed.** No `price`/`fee`/`cost`/`rate`/`amount` field appears in
  any API response or anywhere in the app bundle. [verified]
- **Capacity: not exposed per resource.** `GET /api/occupancy` → HTTP 400 without a
  booking context. [verified live]
- **Accessibility filtering: NOT verified.** The "Accessible" attribute (`-32756`)
  exists in `/api/attribute/filterable`, but adding a `filterData`
  (`[{attributeDefinitionId:-32756, enumValues:[0]}]`) to `/api/availability/map`
  produced an **identical** result set (87 → 87), i.e. the server ignored the
  inferred shape. The minified bundle hides the real `filterData` encoding, and
  guessing further means blindly probing a protected government endpoint. So we
  currently have **no verified way to read or filter per-site accessibility** from
  this API. [verified live — negative result]

## RESOLUTION — headless-browser capture (authorized)

A single off-peak headless session of the real booking-results page revealed the
endpoint that static bundle analysis missed, and **resolves the accessibility,
name, and capacity gaps**. This section is the authoritative contract for the M1
provider; the "deep-dig negative results" above are kept only as a record of what
the direct/guessed approaches showed.

- **`GET /api/resourcelocation/resources?resourceLocationId=<id>`** — the resource
  collection, a dict keyed by `resourceId`. Each entry has: `localizedValues[].name`
  (the **site name/number**, e.g. "101"), `minCapacity`/`maxCapacity`/`maxAdultCapacity`,
  `definedAttributes[]` ({`attributeDefinitionId`, `values[]`}), `feeScheduleId`,
  `allowedEquipment`, `mapIds`, `photos`. (422 resources for the test campground.)
  [verified live]
- **Join works perfectly:** every `resourceId` in the `/api/availability/map`
  response is present in this collection (87/87, 0 missing). So availability
  (open/closed) joins to name/capacity/attributes by `resourceId`. [verified live]
- **Per-site accessibility — SOLVED:** attribute **`-32756` "Accessible"**, value
  `0 = Yes`, `1 = No`, is present on every resource. For the test campground: 8
  accessible sites (104, 105, 107, 109, 110, 205, 206, 208), 414 not. The Service
  Type attribute (`-32768`, "Accessible, …" enum variants) flags the **same 8**
  sites — a 100% cross-check. [verified live]
- **Accessibility filtering is client-side:** the real app sends `filterData=[]`
  and filters results in the browser using the resource attributes. So
  `accessible_only` is implemented by reading `-32756` per site and filtering
  locally — no server `filterData` encoding required. [verified live]
- Confirmed availability params the SPA uses: `mapId, bookingCategoryId=0,
  equipmentCategoryId=-32768, subEquipmentCategoryId=<equip|omit>, startDate,
  endDate, getDailyAvailability=false, isReserving=true, filterData=[],
  numEquipment, seed=<timestamp cache-buster>`. [verified live]

### Verified data flow for `search_sites`

1. `GET /api/resourcelocation/resources?resourceLocationId=<rlid>` → name, capacity,
   accessibility (`-32756`), service type, equipment, photos per `resourceId`.
2. `GET /api/availability/map?mapId=<rootMapId>&…&filterData=[]` → which
   `resourceId`s are open (`availability == 0`); recurse `mapLinkAvailabilities`
   child maps.
3. Join on `resourceId`; if `accessible_only`, keep `-32756 == 0`.
4. Build the campground-level booking deep link.

**Outcome:** M1 can deliver real per-site results *with accessibility*, satisfying
Constitution Art. 3. Price is still not directly verified (`feeScheduleId` would
need a fee-schedule lookup); it stays optional/`None` for M1 and is flagged, not
guessed (Art. 7.1).

## Price investigation (resolved — no read-only source)

A second authorized headless session loaded the results page for a window with
availability and recorded every `/api` **response body**, then attempted a
read-only list/site selection. Findings:

- The results page makes ~32 distinct read-only calls; **none return a per-site
  price.** (`ratecategory/ratecategories` returns category names like "Full",
  no amounts; the only "price" token in any body was config inside
  `/api/transactionlocation`.)
- In the app bundle, price appears only as **cart line-item** fields built from
  product versions: `price.preTaxUnitPrice`, `lineItemPrice`, `getTotalFees`.
  These are populated when a site is added toward a cart (`/api/cart`), i.e.
  inside the booking flow.

**Conclusion:** there is no read-only "price for site X on dates Y" endpoint.
Obtaining a price requires entering the cart/booking flow (a consequential,
potentially inventory-holding action) which we deliberately do not perform
(Constitution Art. 2.2 / 2.4). Therefore `AvailableSite.price` stays `None` by
design; the citizen sees the price in their own session via the prepared booking
link (prepare-then-confirm). This is a principled limit, not a missing feature.
