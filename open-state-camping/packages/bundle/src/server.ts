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
import { ParksCanadaProvider } from "@open-state/core";
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
 * unreliable date arithmetic.
 */
export const SERVER_INSTRUCTIONS = [
  "The Open State: Camping helps a citizen find and book Parks Canada campsites accessibly.",
  "",
  "Dates — important: you are not reliable at calendar arithmetic. Do NOT state the",
  "day of the week for a date, and do NOT decide which year a bare date like",
  '"June 16" means, on your own — and do not announce a weekday in passing before',
  "checking. For ANY date the citizen mentions, call resolve_dates FIRST (give the",
  "month and day; leave the year off for the next upcoming occurrence) and use the",
  "exact start_date / end_date and weekday it returns. The search and booking tools",
  "also report each date's correct weekday — trust those over your own calculation;",
  "if you ever wrote a weekday yourself, recheck it against the tool output.",
  "",
  "Booking: to book or reserve a site, use prepare_booking — it completes the",
  "reservation up to the payment screen so the citizen only enters their card.",
  "Never tell the citizen to go book it themselves on the website, and never hand",
  "them a raw booking link unless prepare_booking genuinely cannot be used.",
  "",
  "Photos: when get_site_details returns a site's photos, describe in your reply",
  "what they actually show — how exposed, treed, sloped, level, or private the site",
  "looks. A plain-language description is more accessible than the image and reaches",
  "citizens who use a screen reader or can't easily open the photo. The photos also",
  "come with a clickable link each; mention they can open those to see for themselves.",
].join("\n");

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
    { instructions: SERVER_INSTRUCTIONS },
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
