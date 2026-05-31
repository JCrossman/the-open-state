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
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, ".mcpb-build");
const serverDir = join(stage, "server");
const out = join(serverDir, "index.mjs");

rmSync(stage, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

await build({
  entryPoints: [join(root, "src/server.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // puppeteer-core can't be cleanly inlined (dynamic requires + its own deps);
  // ship it in server/node_modules and load it lazily at runtime instead.
  external: ["puppeteer-core"],
});

// Run as `node server/index.mjs` (no shebang needed). Strip any shebang the
// entry carried, and prepend a real `require` for any CJS dep that needs it.
let code = readFileSync(out, "utf8").replace(/^#!.*\n/gm, "");
code =
  "import { createRequire as __createRequire } from 'node:module';\n" +
  "const require = __createRequire(import.meta.url);\n" +
  code;
writeFileSync(out, code);

// Materialize puppeteer-core (+ its deps) next to the entry so the bundled
// server can `import('puppeteer-core')` at runtime. Done at build time; the
// resulting node_modules ships inside the .mcpb (the citizen installs nothing).
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ppVersion = pkg.dependencies["puppeteer-core"];
writeFileSync(
  join(serverDir, "package.json"),
  JSON.stringify({ name: "open-state-camping-server", private: true }, null, 2),
);
console.log(`Installing puppeteer-core@${ppVersion} into the bundle...`);
execFileSync(
  "npm",
  ["install", `puppeteer-core@${ppVersion}`, "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund"],
  { cwd: serverDir, stdio: "inherit" },
);

cpSync(join(root, "manifest.json"), join(stage, "manifest.json"));
console.log("Staged .mcpb contents at", stage);

