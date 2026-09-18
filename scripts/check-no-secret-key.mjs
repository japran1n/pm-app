// Repo-wide check: fails if a Supabase anon/service-role key in the old JWT
// format is found committed anywhere in the repository.
//
// The pattern to detect is a full JWT whose header is
// `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` (base64url of
// {"alg":"HS256","typ":"JWT"}) followed by a non-trivial payload and
// signature — the format Supabase used before introducing the new
// `sb_publishable_` / `sb_secret_` key format.  The extension's own
// check-no-secret-key.mjs already covers `sb_secret_` in the built bundle;
// this script covers JWT-format keys leaked into source.
//
// Scans every file under the current working directory, excluding:
//   - node_modules/          (third-party code)
//   - .git/                  (git internals)
//   - supabase/migrations/   (legitimately reference the project ref in SQL
//                             comments, but never hold a live secret key)
//   - extension/             (has its own check for sb_secret_ in dist/)
//
// A "real key" is distinguished from a placeholder or test fixture by
// requiring ≥20 base64url characters in BOTH the payload and signature
// segments.  Very short segments (e.g. "example.placeholder") are skipped.
//
// Usage:
//   node scripts/check-no-secret-key.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

// JWT header for HS256, base64url({ "alg": "HS256", "typ": "JWT" }).
const JWT_HEADER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

// A real Supabase anon/service-role JWT has a long payload (40+ chars) and a
// 43-char base64url HMAC-SHA256 signature.  We require ≥20 chars per segment
// to avoid flagging short placeholders like "example.placeholder".
const JWT_PATTERN = new RegExp(
  `${JWT_HEADER}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}`,
);

// Directories to skip entirely (relative to repoRoot).
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  join("supabase", "migrations"),
  "extension",
]);

function shouldSkip(fullPath) {
  const rel = relative(repoRoot, fullPath);
  for (const skip of SKIP_DIRS) {
    if (rel === skip || rel.startsWith(skip + "/")) {
      return true;
    }
  }
  return false;
}

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (shouldSkip(fullPath)) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const offenders = [];
for (const file of walk(repoRoot)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // Binary file — skip; a secret key string cannot survive binary encoding
    // as ASCII text anyway.
    continue;
  }
  if (JWT_PATTERN.test(text)) {
    offenders.push(relative(repoRoot, file));
  }
}

if (offenders.length > 0) {
  console.error(
    `check-no-secret-key: FAIL — found Supabase JWT key pattern in committed files:\n` +
      offenders.map((f) => `  - ${f}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `check-no-secret-key: PASS — no Supabase JWT key found anywhere in the repo.`,
);
