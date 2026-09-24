// Fails CI/local runs when a local migration file has no counterpart on the
// linked remote Supabase project ("drift"), so a broken deploy is caught
// before it reaches production rather than being discovered by a runtime
// error.
//
// Shells out to `supabase migration list --linked --output-format json`
// (using SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF from the environment,
// matching the existing db:apply script's invocation style) and checks every
// entry's `remote` field.
//
// It also compares NAMES, not just versions: a local migration whose
// version is already recorded on the remote under a different name (e.g. a
// file renumbered after its original version was applied) is "shadowed" —
// the version check passes and `db:apply` skips it, so it never runs. That
// is how 20261127010000 / 20261127020000 silently never reached production.
// The remote names come from supabase_migrations.schema_migrations via the
// Management API query endpoint (same call style as scripts/apply-migration.mjs).
//
// Run:  npm run migrations:check

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

import { redactSecrets } from "./lib/redact-secrets.mjs";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

// Re-exported so existing imports of `redactSecrets` from this module (this
// script's own tests) keep working. The implementation now lives in
// scripts/lib/redact-secrets.mjs so scripts/check-realtime-publication.mjs
// can share it rather than maintaining a second, hand-listed copy.
export { redactSecrets };

/**
 * The minimal set of environment variables the `supabase` CLI needs to run
 * `migration list --linked`. Narrowing the child's env (rather than handing
 * it the full `process.env`) means a credential the parent process holds
 * for an unrelated purpose can never leak into the child, or from the
 * child's stderr back out to this script's own output.
 *
 * @param {object} env
 * @returns {object}
 */
export function buildChildEnv(env = process.env) {
  const allow = [
    "PATH",
    "HOME",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_DB_PASSWORD",
    "npm_config_cache",
    "TMPDIR",
    "APPDATA",
  ];
  const child = {};
  for (const key of allow) {
    if (env?.[key] !== undefined) child[key] = env[key];
  }
  return child;
}

/**
 * Pure drift-detection logic, testable without spawning a subprocess.
 * Takes the parsed JSON payload from `supabase migration list` and returns
 * the list of migration entries present locally but missing on remote.
 *
 * @param {{ migrations?: Array<{ local?: string, remote?: string, time?: string }> }} payload
 * @returns {Array<{ local?: string, remote?: string, time?: string }>}
 */
export function findDrift(payload) {
  const migrations = payload?.migrations ?? [];
  return migrations.filter((entry) => !entry.remote);
}

/**
 * Runs `supabase migration list --linked --output-format json` and returns
 * its parsed stdout. Never includes the credential values in the spawned
 * command line's error output — the token is passed via the environment,
 * not argv, and the raw command is never echoed.
 *
 * @returns {{ status: number, payload: object | null, stderr: string }}
 */
export function runMigrationList({ env = process.env } = {}) {
  const result = spawnSync(
    "npx",
    ["supabase", "migration", "list", "--linked", "--output-format", "json"],
    { env: buildChildEnv(env), encoding: "utf8" },
  );

  if (result.error || result.status !== 0) {
    const rawStderr = result.stderr || String(result.error?.message ?? "unknown error");
    return {
      status: result.status ?? 1,
      payload: null,
      stderr: redactSecrets(rawStderr, env),
    };
  }

  try {
    return { status: 0, payload: JSON.parse(result.stdout), stderr: "" };
  } catch {
    return { status: 1, payload: null, stderr: "Could not parse migration list output as JSON." };
  }
}

/**
 * Runs the guard and returns an exit code + messages, without touching
 * process.exit/console directly, so tests can assert on the outcome without
 * mocking global process state.
 *
 * @param {{ accessToken?: string, projectRef?: string, env?: object }} options
 * @returns {{ code: number, message: string, isError: boolean }}
 */
export function checkDrift({ accessToken = ACCESS_TOKEN, projectRef = PROJECT_REF, env = process.env } = {}) {
  if (!accessToken || !projectRef) {
    return {
      code: 1,
      isError: true,
      message: "Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env",
    };
  }

  const { status, payload, stderr } = runMigrationList({ env });
  const safeStderr = redactSecrets(redactSecrets(stderr, env), { SUPABASE_ACCESS_TOKEN: accessToken, SUPABASE_PROJECT_REF: projectRef });

  if (status !== 0 || !payload) {
    return {
      code: 1,
      isError: true,
      message: `Failed to list migrations from the linked Supabase project.${safeStderr ? ` ${safeStderr}` : ""}`,
    };
  }

  const drifted = findDrift(payload);

  if (drifted.length > 0) {
    const names = drifted.map((entry) => entry.local ?? "(unknown version)").join(", ");
    return {
      code: 1,
      isError: true,
      message: `Migration drift detected — local migrations with no remote counterpart: ${names}`,
    };
  }

  return {
    code: 0,
    isError: false,
    message: "✓ No migration drift — all migrations present on remote.",
  };
}

/**
 * Shadowed versions whose statements were re-applied under a new version.
 * Each entry must name the migration that supersedes it. The old files stay
 * byte-identical as history. Add an entry ONLY after the superseding
 * migration has been applied.
 */
export const SUPERSEDED_SHADOWED = {
  "20261127010000": "20261129010000_security_reapply_shadowed_hardening",
  "20261127020000": "20261129010000_security_reapply_shadowed_hardening",
};

/**
 * Pure name-mismatch logic, testable without network access. Returns every
 * local migration whose 14-digit version is recorded on the remote under a
 * different name, except versions listed in `superseded`.
 *
 * @param {string[]} localFiles  migration basenames, with or without ".sql"
 * @param {Array<{ version: string, name?: string | null }>} remoteRows
 * @param {Record<string, string>} [superseded]
 * @returns {Array<{ version: string, localName: string, remoteName: string }>}
 */
export function findNameMismatches(localFiles, remoteRows, superseded = SUPERSEDED_SHADOWED) {
  const remote = new Map((remoteRows ?? []).map((row) => [row.version, row.name ?? ""]));
  const mismatches = [];
  for (const file of localFiles ?? []) {
    const base = file.replace(/\.sql$/, "");
    const version = base.slice(0, 14);
    const localName = base.slice(15);
    if (!remote.has(version) || superseded[version]) continue;
    const remoteName = remote.get(version);
    if (remoteName !== localName) mismatches.push({ version, localName, remoteName });
  }
  return mismatches;
}

/**
 * Fetches (version, name) from the remote ledger and compares it against
 * the local migration filenames. Never includes credential values in its
 * message.
 *
 * @param {{ accessToken?: string, projectRef?: string, env?: object, migrationsDir?: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ code: number, message: string, isError: boolean }>}
 */
export async function checkNameDrift({
  accessToken = ACCESS_TOKEN,
  projectRef = PROJECT_REF,
  env = process.env,
  migrationsDir = "supabase/migrations",
  fetchImpl = fetch,
} = {}) {
  if (!accessToken || !projectRef) {
    return {
      code: 1,
      isError: true,
      message: "Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env",
    };
  }

  const secrets = { SUPABASE_ACCESS_TOKEN: accessToken, SUPABASE_PROJECT_REF: projectRef };
  let rows;
  try {
    const response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "select version, name from supabase_migrations.schema_migrations;",
        }),
      },
    );
    const body = await response.text();
    if (!response.ok) throw new Error(body);
    rows = JSON.parse(body);
  } catch (error) {
    const safe = redactSecrets(redactSecrets(String(error?.message ?? error), env), secrets);
    return {
      code: 1,
      isError: true,
      message: `Failed to read migration names from the linked Supabase project. ${safe}`,
    };
  }

  const localFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));
  const mismatches = findNameMismatches(localFiles, rows);

  if (mismatches.length > 0) {
    const list = mismatches
      .map((m) => `${m.version}_${m.localName} (remote: ${m.remoteName || "(no name)"})`)
      .join(", ");
    return {
      code: 1,
      isError: true,
      message: `Migration drift detected — local migrations shadowed by a different remote migration with the same version (never applied): ${list}`,
    };
  }

  return {
    code: 0,
    isError: false,
    message: "✓ No migration name drift — every local version matches its remote name.",
  };
}

async function main() {
  let exitCode = 0;
  for (const result of [checkDrift(), await checkNameDrift()]) {
    if (result.isError) {
      console.error(result.message);
    } else {
      console.log(result.message);
    }
    exitCode = Math.max(exitCode, result.code);
  }
  process.exit(exitCode);
}

// Only run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
