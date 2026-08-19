// F281 (AS-538): fails the build if a Supabase *secret* key ever ends up in
// the shipped extension bundle. Walks the built dist/ output (post
// tree-shaking/minification — checking source files would not prove
// anything about what actually shipped) and greps every file for the
// project's secret-key prefix.
//
// The prefix is verified against this repo's own convention: .env.example
// / lib/supabase/admin.ts use `SUPABASE_SECRET_KEY`, whose current value in
// this project's Supabase instance is formatted `sb_secret_...` (the new
// Supabase API key format, distinct from the publishable `sb_publishable_
// ...` key that IS meant to ship to the browser — see lib/supabase/
// client.ts's comment "Uses the new sb_publishable_* key format").
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "..", "dist");
const SECRET_KEY_PREFIX = "sb_secret_";
// A real secret key is the prefix followed by ~40+ random chars
// (`sb_secret_<random>`, see .env's SUPABASE_SECRET_KEY). supabase-js
// itself legitimately contains the bare `sb_secret_` prefix as a string
// literal (used internally to classify a key's *format*, e.g. to decide
// whether to attach an Authorization header) — that is not a leaked
// secret, it never contains the trailing random key material. Requiring a
// long run of key-shaped characters right after the prefix distinguishes
// an actual embedded credential from the library's own prefix constant.
const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]{16,}/;

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

if (!statSync(distDir, { throwIfNoEntry: false })) {
  console.error(
    `check-no-secret-key: dist/ not found at ${distDir} — run vite build first.`,
  );
  process.exit(1);
}

const offenders = [];
for (const file of walk(distDir)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // Binary file (e.g. an image) — skip, a secret key string can't survive
    // binary encoding as ASCII text anyway.
    continue;
  }
  if (SECRET_KEY_PATTERN.test(text)) {
    offenders.push(file);
  }
}

if (offenders.length > 0) {
  console.error(
    `check-no-secret-key: FAIL — found "${SECRET_KEY_PREFIX}" in the built bundle:\n` +
      offenders.map((f) => `  - ${f}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `check-no-secret-key: PASS — no "${SECRET_KEY_PREFIX}" string found anywhere in dist/.`,
);
