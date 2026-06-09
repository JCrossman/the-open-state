import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERSION } from "../src/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name: string) =>
  JSON.parse(readFileSync(join(root, name), "utf8")) as { version: string };

describe("version is single-sourced", () => {
  // The MCP server version (VERSION), the npm package version, and the .mcpb
  // manifest version must agree. If they drift, an install shows a stale version
  // and the server reports the wrong one. build-mcpb.mjs also guards pkg↔manifest.
  it("VERSION matches package.json and manifest.json", () => {
    const pkg = readJson("package.json").version;
    const manifest = readJson("manifest.json").version;
    expect(VERSION).toBe(pkg);
    expect(VERSION).toBe(manifest);
  });
});
