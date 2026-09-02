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
// Run:  npm run migrations:check

import { spawnSync } from "node:child_process";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

/**
 * Replaces any occurrence of the known secret-looking env values with a
 * placeholder, so a credential the Supabase CLI happens to echo into stderr
 * (a connection string, a token) never reaches this script's own output.
 *
 * @param {string} text
 * @param {object} env
 * @returns {string}
 */
export function redactSecrets(text, env = process.env) {
  if (!text) return text;
  const secretKeys = [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  let redacted = text;
  for (const key of secretKeys) {
    const value = env?.[key];
    if (value && typeof value === "string" && value.length >= 6) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
  }
  return redacted;
}

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

async function main() {
  const { code, message, isError } = checkDrift();
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
