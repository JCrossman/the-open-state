#!/usr/bin/env node
/**
 * PII tripwire — defense-in-depth, not a guarantee (Constitution Art. 5, 7.1).
 *
 * GitHub secret scanning catches *credentials*; it does NOT catch personal data.
 * This is a deliberately small grep for the PII most likely to slip into a fixture
 * or a test by accident in a Canadian civic/health project: real-looking emails,
 * formatted phone numbers, and SIN-format numbers. It fails CI on a hit.
 *
 * It is honestly partial (Art. 7.1): it cannot catch a plain name, a free-text
 * address, or a date of birth. Those rely on synthetic fixtures, the AGENTS.md
 * "no PII in the repo" rule, and human review. Treat a clean run as "no obvious
 * slip," never as "no PII."
 *
 * Intentional synthetic/test data should be unmistakably fake — an `example.com`
 * email, a `555`-exchange phone (the reserved fictional range) — or, where that's
 * impossible, carry a `pii-allow` comment on the line. Never commit real data.
 *
 * Run: `node scripts/check-pii.mjs`  (also wired into CI).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SELF = "scripts/check-pii.mjs";
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mcpb|lock)$/i;
const SKIP_FILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/;

// Domains reserved for examples/tests (RFC 2606) or public org contacts — not PII.
const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "example.edu",
  "test", "localhost", "invalid", "anthropic.com",
]);
// Toll-free / non-geographic area codes reveal no personal location — not PII.
const TOLLFREE = new Set(["800", "833", "844", "855", "866", "877", "888", "822", "880", "887", "889"]);

const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
// Formatted North-American phone (needs separators, so bare id digit-runs don't match).
const PHONE = /(?:\+?1[-. ]?)?(?:\((\d{3})\)|(\d{3}))[-. ](\d{3})[-. ](\d{4})\b/g;
const SIN = /\b\d{3}-\d{3}-\d{3}\b/g; // Canadian SIN format NNN-NNN-NNN

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => f !== SELF && !SKIP_EXT.test(f) && !SKIP_FILE.test(f));

const findings = [];

for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue; // binary: contains a NUL byte
  const text = buf.toString("utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes("pii-allow")) return; // documented, intentional exception
    const at = `${file}:${i + 1}`;

    for (const m of line.matchAll(EMAIL)) {
      const domain = m[1].toLowerCase();
      const ok =
        m[0].toLowerCase().startsWith("noreply") ||
        [...ALLOWED_EMAIL_DOMAINS].some((d) => domain === d || domain.endsWith("." + d));
      if (!ok) findings.push([at, "email", m[0]]);
    }
    for (const m of line.matchAll(PHONE)) {
      const area = m[1] || m[2];
      const exchange = m[3];
      if (TOLLFREE.has(area) || exchange === "555") continue; // toll-free / fictional
      findings.push([at, "phone", m[0].trim()]);
    }
    for (const m of line.matchAll(SIN)) findings.push([at, "SIN-format", m[0]]);
  });
}

if (findings.length) {
  console.error(`PII tripwire: ${findings.length} possible match(es) — review before committing:\n`);
  for (const [at, kind, val] of findings) console.error(`  ${at}  [${kind}]  ${val}`);
  console.error(
    `\nIf a hit is intentional test data or a public contact, make it unmistakably\n` +
      `fake (example.com email, 555-exchange phone) or add a "pii-allow" comment on\n` +
      `the line. Never commit a real citizen's personal data (Constitution Art. 5).`,
  );
  process.exit(1);
}
console.log(`PII tripwire: clean — no obvious PII in ${files.length} tracked files scanned.`);
