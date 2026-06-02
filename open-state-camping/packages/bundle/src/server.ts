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

/** Build a server around a given provider (used by tests with a fixture provider). */
export function createServerForProvider(
  provider: ParksCanadaProvider,
  config: BundleConfig,
): McpServer {
  const server = new McpServer({
    name: "open-state-camping",
    version: "0.1.0",
  });
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
