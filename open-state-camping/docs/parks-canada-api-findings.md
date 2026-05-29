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

**Conclusion.** Parks Canada's current public API reliably yields: per-campground
availability (open `resourceId`s for dates/equipment/party), a prepared
campground-level booking deep link, and season schedules. It does **not** (as far
as can be verified without a headless-browser capture of the real booking flow)
expose per-site name, price, capacity, or a working accessibility filter. Since
accessibility is the entire point of this project (Constitution Art. 3), this is a
material limitation that needs a deliberate decision — not something to paper over
with assumptions (Art. 7.1/7.2). **Open decision.**
