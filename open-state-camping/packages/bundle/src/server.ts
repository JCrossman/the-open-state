#!/usr/bin/env node
/**
 * The Open State: Camping — local MCP bundle (stdio).
 *
 * Runs on the citizen's own machine inside their AI assistant. Anonymous search
 * needs no login; the credentialed booking flow (added next) keeps the citizen's
 * session in a local encrypted vault that never leaves the device (Constitution
 * Articles 1 and 10). This server never books on its own — the human confirms.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ParksCanadaProvider, todayUTC, weekdayLongName } from "@open-state/core";
import { configFromEnv } from "./config.js";
import { registerTools } from "./tools.js";
import { registerAccountTools } from "./account-tools.js";
import { registerBookingTools } from "./booking-tools.js";
import { loadSession, sessionAuthHeaders } from "./session/vault.js";

import type { BundleConfig } from "./config.js";

/**
 * Server-level instructions, surfaced to the assistant globally (not just when a
 * tool runs). This is the strongest place to counter behaviours that happen in
 * the assistant's own prose *before* it calls a tool — most importantly its
 * unreliable date arithmetic. Computed fresh per connection so today's date is
 * a real anchor.
 */
export function serverInstructions(): string {
  const today = todayUTC();
  return [
    "The Open State: Camping helps a citizen find and book Parks Canada campsites accessibly.",
    "",
    `Today's date is ${weekdayLongName(today)}, ${today} (computed on the citizen's machine).`,
    "Use this as the current date. A camping date the citizen names is in the future,",
    "not the past — if you ever think a near date is in the past, you have the year wrong.",
    "",
    "Dates — you are NOT reliable at calendar arithmetic, so do not do it in your head:",
    "do not state a day of the week, and do not decide which year a bare date like",
    '"June 16" means, on your own. For ANY date the citizen mentions, call resolve_dates',
    "first (give month and day; leave the year off for the next upcoming occurrence) and",
    "use the exact start_date / end_date and weekday it returns. Search and booking",
    "results also include the correct weekday — trust those over your own calculation.",
    "",
    "Presenting results: keep it conversational and screen-reader friendly. Do NOT show",
    "the internal campsite or campground id numbers to the citizen, and do NOT render",
    "tables of ids — those ids are only for your own tool calls. Describe each site by",
    "its site number and useful features (hookups, accessibility, shade, fire pit).",
    "",
    "Photos: when get_site_details returns a site's photos, they appear in the",
    "citizen's Content panel automatically. Describe in words what they show (how",
    "exposed, treed, level, or private the site looks) so the citizen gets the",
    "picture without opening anything. Do NOT paste image links or markdown images",
    "into your reply — remote image links render as click-to-load tiles that pop a",
    "browser window, which is a worse experience.",
    "",
    "Booking: to book or reserve a site, use prepare_booking — it completes the",
    "reservation up to the payment screen so the citizen only enters their card.",
    "Never tell the citizen to go book it themselves on the website, and never hand",
    "them a raw booking link unless prepare_booking genuinely cannot be used.",
  ].join("\n");
}

/** Build a server around a given provider (used by tests with a fixture provider). */
export function createServerForProvider(
  provider: ParksCanadaProvider,
  config: BundleConfig,
): McpServer {
  const server = new McpServer(
    {
      name: "open-state-camping",
      version: "0.1.0",
    },
    { instructions: serverInstructions() },
  );
  registerTools(server, provider, config);
  return server;
}

export function createServer(): McpServer {
  const config = configFromEnv();
  // Replay the citizen's captured session (when connected) on every API call,
  // read fresh each time so connect/disconnect take effect immediately.
  const provider = new ParksCanadaProvider({
    userAgent: config.userAgent,
    timeoutMs: config.timeoutMs,
    authHeaders: () => {
      const session = loadSession();
      return session ? sessionAuthHeaders(session) : undefined;
    },
  });
  const server = createServerForProvider(provider, config);
  registerAccountTools(server, provider);
  registerBookingTools(server, provider);
  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting open-state-camping:", err);
  process.exit(1);
});
