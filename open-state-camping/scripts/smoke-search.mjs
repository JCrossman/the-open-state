#!/usr/bin/env node
/**
 * Smoke test for The Open State: Camping — exercises every SEARCH family against the
 * live Parks Canada API. Read-only: no login, nothing held, nothing booked. Safe to
 * run repeatedly. (Booking needs your captured session, so test that in Claude Desktop
 * with the prompts in the README / chat.)
 *
 *   1. pnpm -r build      # build the workspace first
 *   2. node scripts/smoke-search.mjs
 *
 * Override the defaults from the command line, e.g.:
 *   node scripts/smoke-search.mjs --park "Jasper" --start 2026-08-10 --end 2026-08-12 --party 2
 *   node scripts/smoke-search.mjs --dayuse "Lake O'Hara bus" --backcountry "Glacier"
 *
 * Run from the open-state-camping/ directory.
 */
import { ParksCanadaProvider } from "../packages/core/dist/index.js";

// ---- config (CLI overrides) ------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CFG = {
  park: arg("park", "Banff"),
  start: arg("start", "2026-08-11"),
  end: arg("end", "2026-08-13"), // 2-night window
  party: Number(arg("party", "2")),
  dayuse: arg("dayuse", "Moraine Lake shuttle"),
  backcountry: arg("backcountry", "Glacier"),
};

const provider = new ParksCanadaProvider({});
const line = (s = "") => console.log(s);
const head = (s) => line(`\n=== ${s} ===`);

async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const clean = /Azure WAF|HTTP 403/.test(msg)
      ? "rate-limited (Azure WAF) — wait a minute and re-run, or run from your home connection"
      : msg.replace(/\s+/g, " ").slice(0, 160);
    line(`  ✗ ${label}: ${clean}`);
  }
}

line(`The Open State: Camping — search smoke test`);
line(`park="${CFG.park}"  stay=${CFG.start}..${CFG.end}  party=${CFG.party}`);

// 1) What does the park offer?
head(`search_parks: "${CFG.park}"`);
let firstCampgroundId;
await step("search_parks", async () => {
  const areas = await provider.searchParks(CFG.park);
  const cgs = areas[0]?.campgrounds ?? [];
  line(`  ${cgs.length} campground(s).`);
  for (const c of cgs.slice(0, 8)) {
    line(`  - ${c.name}  [offers: ${(c.offers ?? []).join(", ") || "—"}]`);
  }
  firstCampgroundId = cgs[0]?.campgroundId;
});

// 2) Campsite / 3) Accommodation / 4) Group — whole-park availability per category
for (const category of ["campsite", "accommodation", "group"]) {
  head(`search_park_availability: ${category}`);
  await step(category, async () => {
    const res = await provider.searchParkAvailability({
      query: CFG.park,
      startDate: CFG.start,
      endDate: CFG.end,
      partySize: CFG.party,
      category,
    });
    const open = res.filter((r) => r.openSiteCount > 0);
    const total = res.reduce((s, r) => s + r.openSiteCount, 0);
    line(`  ${total} open across ${res.length} campground(s); top:`);
    for (const r of open.slice(0, 5)) {
      line(`  - ${r.campgroundName}: ${r.openSiteCount} (${r.accessibleCount} accessible)`);
    }
    if (open.length === 0) line(`  (none open for these dates — try other dates)`);
  });
}

// 5) Day Use — browse + search
head(`search_day_use: browse`);
await step("day-use browse", async () => {
  const products = await provider.listDayUseProducts();
  line(`  ${products.length} products:`);
  for (const p of products) line(`  - ${p.product}`);
});
head(`search_day_use: "${CFG.dayuse}"`);
await step("day-use search", async () => {
  const slots = await provider.searchDayUse({
    query: CFG.dayuse,
    startDate: CFG.start,
    endDate: CFG.start, // a single day
    partySize: CFG.party,
  });
  line(`  ${slots.length} open time slot(s) on ${CFG.start}; sample:`);
  for (const s of slots.slice(0, 6)) line(`  - ${s.slotName} — ${s.remaining} spot(s)`);
  if (slots.length === 0) line(`  (none — bookings may not be open yet, or sold out)`);
});

// 6) Backcountry — browse + search
head(`search_backcountry: browse "${CFG.backcountry}"`);
await step("backcountry browse", async () => {
  const areas = await provider.listBackcountryProducts(CFG.backcountry);
  line(`  ${areas.length} area(s):`);
  for (const a of areas.slice(0, 8)) line(`  - ${a.product}`);
});
head(`search_backcountry: "${CFG.backcountry}"`);
await step("backcountry search", async () => {
  const zones = await provider.searchBackcountry({
    query: CFG.backcountry,
    startDate: CFG.start,
    endDate: CFG.end,
    partySize: CFG.party,
  });
  line(`  ${zones.length} zone(s) with room for ${CFG.party}; sample:`);
  for (const z of zones.slice(0, 6)) {
    const acc = z.accessible ? ", accessible" : "";
    line(`  - ${z.zoneName} — ${z.openNights.length} night(s), ${z.minRemaining} left${acc}`);
  }
  if (zones.length === 0) line(`  (none for ${CFG.party} — try party 1 or other dates)`);
});

line(`\nDone. (Search only — nothing was held or booked.)`);
