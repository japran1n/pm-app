// Fails when a client-side `postgres_changes` subscription targets a table
// that is not present in the `supabase_realtime` publication on the linked
// project, so a silently-dead realtime subscription (RLS/publication drift)
// is caught before it's discovered as "the UI just doesn't update".
//
// Table discovery is derived from the source tree (components/ and lib/)
// by scanning for `.on("postgres_changes", { ... table: "<name>" ... })`
// bindings — never a hand-maintained list — so a new subscription is
// checked automatically without editing this script (AS-006).
//
// Uses the Supabase Management API query endpoint, same pattern as
// scripts/apply-migration.mjs (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
// from .env).
//
// Run:  npm run realtime:check

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

const SCAN_DIRS = ["components", "lib"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/**
 * Pure extraction logic: finds every `table:` value inside a
 * `"postgres_changes"` binding in the given source text. Testable without
 * touching the filesystem.
 *
 * Matches both single-line and multi-line bindings, e.g.:
 *   .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, cb)
 * and
 *   .on(
 *     "postgres_changes",
 *     {
 *       event: "*",
 *       schema: "public",
 *       table: "tasks",
 *     },
 *     cb,
 *   )
 *
 * @param {string} source
 * @returns {string[]} table names referenced (may contain duplicates)
 */
export function extractSubscribedTables(source) {
  const tables = [];
  // Find each `"postgres_changes"` occurrence, then look at a bounded window
  // of text following it for the matching `table: "<name>"` entry — this
  // tolerates either single-line or multi-line object literals without
  // needing a full JS parser.
  const bindingRe = /["']postgres_changes["']/g;
  let match;
  while ((match = bindingRe.exec(source)) !== null) {
    const windowEnd = source.indexOf(")", match.index);
    const window = windowEnd === -1
      ? source.slice(match.index, match.index + 1000)
      : source.slice(match.index, windowEnd + 1);
    const tableMatch = window.match(/table\s*:\s*["'`]([^"'`]+)["'`]/);
    if (tableMatch) {
      tables.push(tableMatch[1]);
    }
  }
  return tables;
}

/**
 * Recursively walks a directory and returns paths of files matching
 * SOURCE_EXTENSIONS. Skips node_modules and dot-directories.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function walkSourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...walkSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Scans the given root directories for `postgres_changes` subscriptions and
 * returns the deduplicated, sorted set of subscribed table names.
 *
 * @param {{ dirs?: string[], readFile?: (path: string) => string }} options
 * @returns {string[]}
 */
export function discoverSubscribedTables({ dirs = SCAN_DIRS, readFile = (p) => readFileSync(p, "utf8") } = {}) {
  const tables = new Set();
  for (const dir of dirs) {
    for (const file of walkSourceFiles(dir)) {
      const source = readFile(file);
      for (const table of extractSubscribedTables(source)) {
        tables.add(table);
      }
    }
  }
  return [...tables].sort();
}

/**
 * Pure comparison logic: returns the subscribed tables that are missing
 * from the publication's table list.
 *
 * @param {string[]} subscribedTables
 * @param {string[]} publishedTables
 * @returns {string[]}
 */
export function findUnpublishedTables(subscribedTables, publishedTables) {
  const published = new Set(publishedTables);
  return subscribedTables.filter((table) => !published.has(table));
}

async function queryPublishedTables({ accessToken, projectRef }) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "select tablename from pg_publication_tables where pubname = 'supabase_realtime';",
      }),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  const rows = JSON.parse(body);
  return rows.map((row) => row.tablename);
}

/**
 * Runs the guard and returns an exit code + message, without touching
 * process.exit/console directly, so tests can assert on the outcome.
 *
 * @param {{ accessToken?: string, projectRef?: string, discover?: () => string[], queryPublished?: () => Promise<string[]> }} options
 * @returns {Promise<{ code: number, message: string, isError: boolean }>}
 */
export async function checkRealtimePublication({
  accessToken = ACCESS_TOKEN,
  projectRef = PROJECT_REF,
  discover = discoverSubscribedTables,
  queryPublished = () => queryPublishedTables({ accessToken, projectRef }),
} = {}) {
  if (!accessToken || !projectRef) {
    return {
      code: 1,
      isError: true,
      message: "Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env",
    };
  }

  const subscribedTables = discover();

  let publishedTables;
  try {
    publishedTables = await queryPublished();
  } catch (error) {
    return {
      code: 1,
      isError: true,
      message: `Failed to query the realtime publication from the linked Supabase project. ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const missing = findUnpublishedTables(subscribedTables, publishedTables);

  if (missing.length > 0) {
    return {
      code: 1,
      isError: true,
      message: `Tables subscribed via postgres_changes but missing from the supabase_realtime publication: ${missing.join(", ")}`,
    };
  }

  return {
    code: 0,
    isError: false,
    message: `✓ All ${subscribedTables.length} subscribed table(s) are present in the supabase_realtime publication.`,
  };
}

async function main() {
  const { code, message, isError } = await checkRealtimePublication();
  if (isError) {
    console.error(message);
  } else {
    console.log(message);
  }
  process.exit(code);
}

// Only run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
