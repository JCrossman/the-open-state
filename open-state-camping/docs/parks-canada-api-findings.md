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

### Booking write path (authenticated; verified working end-to-end)

A booking, in plain language: search → assemble a cart → commit it through the
wizard's stages → hand the citizen their cart in their own browser to pay. Driven
to the **payment screen but not paid** — no reservation and no fee exist until
payment (the fee attaches only *after a reservation is confirmed*). Payment is a
separate step we never automate (Art. 2).

**The full sequence (all verified against the live system):**

1. **`GET /api/cart`** — the server creates a cart and returns it with a
   **server-generated `cartUid`**. (SPA: `initializeNewCart`.) A *client*-minted
   cartUid is rejected.
2. **`GET /api/cart/newtransaction?cartUid=<that>`** — the server initializes the
   transaction and returns the cart with `newTransaction` populated:
   `cartTransactionUid`, `shiftUid`, `userUid`, `referenceNumberPrefix` (`INPC26`),
   `terminalLocationId` (`-2147483647`, the online terminal). (SPA:
   `initializeNewCartTransaction`.) **These are server-authoritative — fabricating
   them (e.g. zero-UUIDs) gets a bare HTTP 400 with no field detail.**
3. Attach the shopper to the cart (SPA: `populateShopperOnCart`): set
   `cart.shopper` = the raw `GET /api/shopper` envelope and
   `cart.newTransaction.shopperUid` = the shopper's uid.
4. Add the booking + hold into *that* cart (only `bookingUid` and
   `resourceBlockerUid` are client-minted) and **`POST
   /api/cart/commit?isCompleted=false&isSelfCheckIn=false`**, re-sending the whole
   `{ "cart": { … } }` at each wizard stage (hold → details → finalize). The first
   commit *is* the hold — no separate hold endpoint; an unpaid cart expires on its own.
5. **Hand-off:** the SPA decides which cart to show from `localStorage`
   (keys `cartUid` / `cartTransactionUid`), **not** from the session — so before
   opening `/cart` in the citizen's browser, seed those keys with the built cart's
   ids, or the page shows a fresh empty cart. Read the cart back with
   **`GET /api/cart/get?cartUid=…&cartTransactionUid=…`** to confirm the booking landed.

**Cart/booking shape:**
- **`cart.bookings[0].newVersion`** carries the booking: `startDate`/`endDate`,
  `equipmentCategoryId`/`subEquipmentCategoryId`, `rateCategoryId` (`-32768`
  standard), `checkInTime` `14:00` / `checkOutTime` `11:00` (from
  `/api/resource/model`), `bookingCapacityCategoryCounts`, `occupant`,
  `bookingMembers`, `resourceBlockerUids`. `completedDate` `null`, `bookingStatus`
  `0` until payment. (`completedDate` is a timestamp on the hold-stage commit only.)
- **Party counts** = four entries under `capacityCategoryId -32767`, by
  `subCapacityCategoryId`: **`-32768` Adult, `-32767` Senior, `-32766` Youth,
  `-32765` Child**.
- **Occupant is a *projection* of the shopper, not a clone.** For "I am the
  occupant": copy `addresses[0]` → `address`, copy `contact` and `phoneNumbers`
  objects across unchanged, carry `firstName`/`lastName`/`email`/
  `preferredCultureName`/`defaultRateCategoryId`/`defaultPassNumber`, set
  `copiedShopperUid = shopperUid`, `bookingCustomerChainUid = null`, and
  `allowMarketing`/`allowEmergencySms` (default `false`). Profile-only fields
  (`vehicles`, `boats`, `communicationPreferences`, flagged dates) are dropped.
- **`bookingMembers[0]`** (added at the finalize stage) = the holder:
  `{ firstName, lastName, isBookingHolder: true, order: 0 }`.
- **`booking.currentVersion` stays `null`** across every commit, so re-committing
  the whole cart is fine — no optimistic-concurrency version to thread back.
- Supporting reads the SPA fires around the commits (not all required to write):
  `/api/availability/resourcestatus`, `/api/resource/model`,
  `/api/resourcelocation/resourceId`, `/api/surcharge/getSurchargeDetailsPackageForBooking`,
  `/api/cart/get|lineitems|resourceinfo`, `/api/bookingvalidation/*`,
  `/api/payment/balanceowing|typesettings` (payment screen).

Implemented in `packages/core/src/{client,booking}.ts` and
`packages/bundle/src/booking-tools.ts`; the cart assembly is checked by an
**offline replay-diff** test (`packages/core/test/booking.test.ts`) against a
sanitized capture in `test/fixtures/booking/` — the cart is rebuilt from inputs and
asserted against what the platform accepted, with no network call. **Lesson that
kept recurring: use the real object the server returns; don't reconstruct it.**

## Resource categories & the four booking groups (verified)

`GET /api/resourcecategory` names every resource category and gives its
`resourceType`, which is the booking-model divider:
- **type 0** — a specific site reserved for nights. Campsite (`-2147483648`),
  Overflow (`-2147483641`), Group (`-2147483640`), Seasonal (`-2147483624`), and
  the accommodations: Yurt (`-2147483647`), oTENTik (`-2147483643`), Ôasis
  (`-2147483644`), Rustic Cabin (`-2147483645`), Cabin (`-2147483646`), MicrOcube
  (`-2147483642`), Prospector Tent (`-2147483630`), Teepee (`-2147483631`),
  Equipped Camping (`-2147483635`).
- **type 2** — Day Use time slots (Shuttle, Parking, Ferry, Guided Hike/Event,
  Fishing, Learn-to, Day Use Bus, Day Runner Hike).
- **type 3** — Backcountry (Backcountry Zone/Site/Shelter/Yurt/Cabin, Hiking/
  Backpacking Trip, Access Point).

`GET /api/searchcriteriatabs` maps the four UI tabs to `bookingCategoryId`s, and
`GET /api/bookingcategories` names them: Campsite 0, Accommodation 1, Group 2, …
**Categorisation is per-resource** (`resource.resourceCategoryId`), *not* a search
filter — `/api/availability/map` returns the same resources for any
`bookingCategoryId`, **but availability only populates for accommodations/group
when the matching `bookingCategoryId` is passed**, so the search must both pass
`bookingCategoryId` *and* filter resources by `resourceCategoryId`.

> ⚠️ Earlier constants mislabeled `-2147483647` as "Overflow" (it's **Yurt**) and
> `-2147483643` as "Group" (it's **oTENTik**); the real Group is `-2147483640` and
> Overflow `-2147483641`. Corrected in `constants.ts` (`RESOURCE_CATEGORY`,
> `CATEGORY_GROUPS`). Model 0 (Campsite / Group / Accommodation) share the
> search+booking machinery; Day Use (model 1) and Backcountry (model 5) do not.

**Model 0 is complete and live-verified** — search *and* booking confirmed
end-to-end for all three categories (Campsite, Group, Accommodation). Accommodation
booking was driven to the payment screen against a real signed-in session (a cabin
held, no payment) on 2026-06-05; the only difference from a campsite booking is the
`bookingCategoryId` (0/2/1) and that accommodations send no equipment.

## Booking models 1 (Day Use) & 5 (Backcountry) — read-only recon

From `GET /api/bookingcategories` (bookingCategoryId → bookingModel → name):

- **Model 0** (done): Campsite 0, Accommodation 1, Group 2 — **and also** West Coast
  Trail 4, Long Range Mountains 13. The last two are model 0, so they likely book
  through our *existing* flow once their bookingCategoryId is added (worth a quick
  verify — potential low-hanging fruit).
- **Model 1 — Day Use** (`resourceType` 2): Guided Hike 3, Parking 8, Shuttle to
  Lake Louise & Moraine Lake 9, Lake O'Hara Day Use Bus 10, DayTripper 11, Fishing
  12, Learn-to 14, Guided Event 15, Chilkoot Day Runner 16. **Time-slot** based
  (start/end time, ticket quantities); `bookingCategoryId` is **per product/park**,
  not one value. No equipment, no nights. *Medium* build: new time-slot availability
  shape + a cart variant. Highest public demand (the Moraine Lake / Lake O'Hara
  access lottery). Needs ~1 HAR at the booking step.
- **Model 5 — Backcountry** (`resourceType` 3): Backcountry Campsite 5, Backcountry
  Zone 7, Chilkoot Trail 17. Built on an **itinerary across zones over multiple
  nights** (`itineraryBuilderHelper`, `tripValidationHelper`) plus **per-party-member
  data collection** (`partyMember{Name,Age,Contact,Date,CapacityCategory,Note}
  CollectionRequirement` — details for *each* person). *High* build: new itinerary
  model + per-person roster + validation; also touches the identity surface. Smaller
  user base. Needs 1+ HAR (itinerary build *and* commit).

Recommendation: **Day Use first** — simpler model, far higher demand, cleaner reuse;
roughly the size of the accommodations work plus a new availability/cart shape.
Backcountry is ~2–3× that, mostly the itinerary builder + per-member collection.

### Day Use availability endpoints (from SPA `chunk-SEEOSVZU.js`, partly probed live)

Day Use does **not** use `/api/availability/map`. Two endpoints, both with query
params `resourceLocationId, startDate, endDate, bookingCategoryId` and a JSON body:
- `POST /api/availability/dailyactivity` — per-day availability list. Body `[]` is
  accepted (**HTTP 200**, returns a JSON **array**; empty for a date with no
  availability). This is the day-grid call.
- `POST /api/availability/activity` — the detailed/slot call; body `[]` returns
  **HTTP 400**, so it needs a specific request body (the `o` arg — a preferences/
  selection object not yet captured).

`bookingCategoryId` is **per product** (Lake O'Hara Bus 10, Lake Louise/Moraine
Shuttle 9, Parking 8, …), and each maps to one day-use facility (e.g. "Yoho - Lake
O'Hara Bus" rlid `-2147483536`, category Day Use Bus `-2147483626`).

**Verified live:** the catalog comes from `/api/bookingcategories`, but each entry
carries `bookingCategoryId, bookingModel, name` and **`allowedResourceCategoryIds`** —
**not** a `resourceLocationId` (an early wrong assumption that broke search until
fixed). A product's facilities are those whose `resourceCategoryIds` intersect its
`allowedResourceCategoryIds`; a product can span several facilities and vice-versa, so
search resolves product↔facility pairs and matches the query against product + facility
name. A facility's **timed slots are its resources** —
`GET /api/resourcelocation/resources` returns e.g. "Moraine Lake: 6:30am-7am",
"Lake Louise: 8am-9am", "…(Last Minute)", "…(Park Use)" (each `maxCapacity` 10).
The day grid is `POST /api/availability/dailyactivity` with **body = array of slot
`resourceId`s** and query `resourceLocationId,startDate,endDate,bookingCategoryId`;
the response is per-slot per-day `availabilityResult.remainingReservableQuota`.

**Day Use SEARCH is built and verified live** (`searchDayUse` + `search_day_use`):
"Moraine Lake shuttle" for a real date returns the open time slots with spots left.
("(Park Use)" slots are filtered out as staff/internal.)

**Backcountry search works (verified live).** The `allowedResourceCategoryIds`
mapping IS correct (a zone facility's zones book under bcid 7, a campsite facility's
under bcid 5 — the captured booking's bcid 5 was a *different*, campsite facility id).
The real bug was that **backcountry facilities carry `rootMapId: null` in
/api/resourceLocation** — their zone maps come from `GET /api/maps?resourceLocationId=`
(top-level nodes like "Hermit Meadows", "Loop Brook"). Walking those with the
category-correct bcid returns per-night quota. Verified: Glacier → Hermit Meadows under
bcid 7 (party 1: 1 spot over 2 nights, matching a captured search). Earlier 0-results
were genuine (no availability under the correct product) or the skipped null-rootMapId
facilities. `searchBackcountry` now falls back to `/api/maps` when `rootMapId` is null.
(WCT bcid 4 and Long Range Mountains bcid 13 appear in the same search as model-0 trail
products with their own maps — bookable via the model-0 flow, still to wire.)

**Day Use BOOKING is built** (from a second, payment-reaching HAR). The model-1 cart
differs from model 0 in exactly these ways (our generated cart is a key-for-key match
to the capture):
- `booking.bookingModel = 1`, `bookingCategoryId =` the product id (e.g. shuttle 9);
- `equipmentCategoryId`/`subEquipmentCategoryId` are **null** (no equipment);
- `checkInTime "10:00"`, `checkOutTime "23:59"` (the full open day), sent every stage;
- the slot is held by a **`resourceZoneBlocker`** (carrying the slot `resourceId` and
  `unitsBlocked` = party size) in `cart.resourceZoneBlockers`, referenced by the
  booking's `resourceZoneBlockerUids`; `resourceBlockers` is empty. The zone-blocker
  UID is client-generated. Same staged `POST /api/cart/commit` (isCompleted=false),
  stopping before payment.

Day Use booking is wired into `prepare_booking` (pass `product_id`); **confirmed
live** — a Moraine Lake shuttle slot was driven to the payment screen against a real
signed-in session (2026-06-08, no payment). Search→book works end-to-end. (Two bugs
fixed en route: the catalog has no `resourceLocationId` so facilities resolve via
`allowedResourceCategoryIds` and the search surfaces the numeric booking ids; and the
browse-mode routing no longer loops when `end_date` is omitted for a single day.)

## Backcountry (model 5) — read-only recon

Products (from `/api/bookingcategories`): Backcountry Campsite 5, Backcountry Zone 7,
Chilkoot Trail 17 (West Coast Trail 4 and Long Range Mountains 13 are *model 0* and
may book via the existing flow — verify-later freebies). 29 facilities carry a
`resourceType` 3 category; their resources are **zones / trailheads** (e.g. "Emerald
Lake Trailhead", category Backcountry Zone `-2147483632`) with null capacity/maxStay.

From the SPA, a backcountry booking is a **multi-leg itinerary**: the itinerary
builder collects, per leg, an **arrival date, departure date, and nights**, chaining
zones from an entry trailhead (`/api/reachableresources/resourcelocationid` gives the
zones reachable next). Availability is per-zone per-night quota
(`/api/availability/map` + `resourcedailyavailability`); the search request object
(`/api/availability/booking`) carries `accessPointResourceId`, `nights`,
`peopleCapacityCategoryCounts`. Booking additionally requires **per-party-member data
collection** (`partyMember{Name,Age,Contact,Date,CapacityCategory,Note}
CollectionRequirement`).

**Booking cart is built and verified** (from a captured Pacific Rim - Broken Group
Islands two-night trip; our generated cart is a key-for-key match). The model-5 cart:
- `bookingModel 5`, `bookingCategoryId` 5/7/17; `checkInTime "12:00"`,
  `checkOutTime "11:00"`; backcountry equipment category (`-32767`, not `-32768`).
- The **itinerary is N `resourceBlockers`** — one per night, each a zone held for one
  day (`resourceId` + start/end), referenced by the booking's `resourceBlockerUids`;
  the booking spans first-leg start → last-leg end. (`buildBookingCart` takes an
  `itinerary: [{resourceId,startDate,endDate}]`; legs become blockers.) Each blocker
  carries `completedDate`/`blockerTransactionStatus` — now added for *all* models, to
  match the captures exactly.

**Search is built.** Backcountry zone availability works **cart-free** via the same
`GET /api/availability/map` (walked recursively) with `bookingCategoryId` = the model-5
product and `equipmentCategoryId` `-32767`. ⚠️ **`availability` is a STATUS code, not a
quota count** — `0` = available that night (exactly like frontcountry's `openNights`),
non-zero = not available. (An early reading of it as a count `≥ party` *inverted* the
result — a full zone returns `1`/`5` and read as "1–5 spots", an open zone returns `0`
and read as "no room", so search reported phantom availability *and* missed real
availability. Verified live: Glacier Hermit Meadows full → `1`; Forillon's five open
zones → `0`, matching the website exactly.) `searchBackcountry`
matches model-5 products by query (browse with no query), walks each facility's zones,
and surfaces accessibility first-class (`accessible_only` filter). Backcountry
facilities aren't in the site-filtered campground list, so root maps resolve via an
unfiltered `listFacilities()`.

**Booking is wired.** `prepare_booking` takes an `itinerary` (one `{zone_id,
start_date, end_date}` per night) plus the `product_id`. **The hold kind is per the
resource's `resourceModel`** (SPA enum: Site=0, NonSpecific=1, Zone=2, AccessPoint=3,
ZoneEntry=4): a **Site** books a specific unit (`resourceBlocker`); a **Zone** is
quota-based and books N of a shared capacity (`resourceZoneBlocker` with `unitsBlocked`,
like Day Use). Using a site blocker on a quota zone is what the platform rejected with
**`ResourceUnavailable`**. So `prepare_booking` looks up each leg's `resourceModel` and
routes the hold accordingly:
- Backcountry **Campsite** (bcid 5): zones are Site-model → per-night `resourceBlocker`,
  equipment from the zone's `allowedEquipment` (the captured cart).
- Backcountry **Zone** (bcid 7): a quota-zone **itinerary** (verified against a captured
  Forillon zone booking). It is an **entry point + per-night zones**:
  - An **entry point** (`entryPointResourceId`) — a trailhead/parking resource,
    `resourceModel 3` (AccessPoint), e.g. "Le Portage trailhead". `prepare_booking`
    auto-uses the facility's single entry point, or lists them and asks if several.
  - One **`resourceZoneBlocker` per night** for that night's zone (`resourceModel 2`,
    `unitsBlocked = party`; nights may be different zones), in a **lean** shape: the
    `newVersion` omits `blockerTransactionStatus`/`completedDate`, AND the top level
    omits `currentVersion`/`history`/`drafts`/`adminCartUid` (Day Use's zone blocker
    keeps all of those — the extra fields on the backcountry blocker triggered
    `InvalidCart`). Only `{blockerType, cartUid, resourceZoneBlockerUid, bookingUid,
    groupHoldUid, isReservation, newVersion}` remain.
  - `checkInTime`/`checkOutTime` = **null**; **no equipment**; and an **extra capacity
    count** keyed by the **product's** `additionalCapacityCategoryId` (constant per product; the zone's own `zoneCapacitySettings.capacityCategoryId` varies per zone and was the wrong source — it produced -32767 for Lean-to Les Lacs and an InvalidCart)
    (`{capacityCategoryId, subCapacityCategoryId: null, count: party}`), with `isAdult`
    flags on the four age-band entries.

Same staged commits, stops before payment; prepare-on-demand only (Art. 2.4).

**Backcountry zone booking confirmed live** (Forillon Lean-to Les Lacs driven to the
payment screen, 2026-06-08) — the last booking family to land. The zone-permit cart is a **key-for-key structural match** to the captured Forillon zone
booking (booking object, capacity counts, blockers). The one thing still unconfirmed is
the live authenticated commit on a *different* park (the error progression
`ResourceUnavailable` → `InvalidCart` → [fixed] tracked the hold-type then the
entry-point/times/capacity deltas).

⚠️ Known follow-up (separate): `search_day_use` can show slots for dates beyond the
booking-release window; those fail at commit with `MaxReservationWindowViolated`. The
window should be surfaced at search time (needs the per-product release schedule).

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
