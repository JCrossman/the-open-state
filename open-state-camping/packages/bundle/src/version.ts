/**
 * The single source of truth for the bundle's version, used as the MCP server's
 * self-reported version. It must stay in lockstep with package.json and
 * manifest.json (the .mcpb version) — version.test.ts asserts all three agree, and
 * scripts/build-mcpb.mjs already refuses to package a package.json/manifest mismatch.
 * Bump all three together when releasing.
 */
export const VERSION = "0.16.0";
