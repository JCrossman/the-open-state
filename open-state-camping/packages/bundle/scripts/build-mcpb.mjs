/**
 * Build the self-contained .mcpb bundle:
 *  1. esbuild-bundle src/server.ts (inlining @open-state/core, the MCP SDK, and
 *     zod) into one ESM file — node built-ins stay external.
 *  2. stage it next to manifest.json, then `mcpb pack` zips the staging dir.
 *
 * Run: `node scripts/build-mcpb.mjs` then `pnpm dlx @anthropic-ai/mcpb pack ...`
 * (the package script `pack` chains both).
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, ".mcpb-build");
const out = join(stage, "server/index.mjs");

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

await build({
  entryPoints: [join(root, "src/server.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
});

// Run as `node server/index.mjs` (no shebang needed). Strip any shebang the
// entry carried, and prepend a real `require` for any CJS dep that needs it.
let code = readFileSync(out, "utf8").replace(/^#!.*\n/gm, "");
code =
  "import { createRequire as __createRequire } from 'node:module';\n" +
  "const require = __createRequire(import.meta.url);\n" +
  code;
writeFileSync(out, code);

cpSync(join(root, "manifest.json"), join(stage, "manifest.json"));
console.log("Staged .mcpb contents at", stage);

