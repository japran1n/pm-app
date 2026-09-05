// Shared pooled-identity + cached-session helper for integration tests
// (F126, missions/20260903-portal — AS-089, AS-090, AS-091).
//
// THE PROBLEM: before this helper, 240 integration test files each created
// a brand-new Supabase Auth user via `admin.auth.admin.createUser` and 167
// of them additionally called `signInWithPassword` — 400+ real auth
// operations per full run against a single hosted Supabase project. That
// is what produced the "Request rate limit reached" failures documented in
// vitest.config.ts (F278, F312) and blocked every attempt at a clean
// full-suite run, and it is also why the shared database accumulated
// thousands of throwaway workspaces/profiles: a failed or timed-out run
// never reaches its own `afterAll`.
//
// THE FIX: a small, fixed-size pool of REAL Supabase Auth users, created
// and signed in ONCE (not once per file), with the resulting session
// tokens cached to a file in the OS temp dir so every migrated test file —
// in every vitest worker process — reuses the same identities and the same
// sessions instead of minting its own. Concurrent worker processes race to
// build the pool exactly once via a simple exclusive-lockfile handshake;
// everyone else waits for the winner's cache file to appear.
//
// WHAT THIS DOES NOT DO — read before using it in a new file:
//
//   - It does not model "roles". A pooled identity is just a real user;
//     which ROLE it plays (owner/admin/member/viewer/guest/client) is
//     whatever your test inserts into `workspace_members.role` for the
//     WORKSPACE YOUR TEST CREATES. Slot N being "the owner" in one file and
//     "the outsider" in another file is fine and expected — a real person
//     legitimately belongs to many workspaces with different roles in each.
//   - It is UNSAFE for any test that assumes "this user has exactly one
//     workspace", asserts on a workspace *list* (membership count, "my
//     workspaces" RPCs, workspace switchers), or reads/writes the user's
//     own global state (profile display_name/avatar_url/timezone,
//     cross-workspace notification counts, account-creation side effects
//     like the profile-auto-create trigger). Those tests must keep their
//     own dedicated, freshly-created user via the pre-existing
//     `admin.auth.admin.createUser` + `signInWithPassword` pattern — do not
//     force them onto this pool.
//   - It never deletes the pooled identities. That is intentional: an
//     individual file's `afterAll` must not delete a pooled identity out
//     from under a different file that is still using it (AS-091 governs
//     the PER-TEST rows a migrated file creates — workspaces, projects,
//     tasks, ... — which each migrated file still tracks and deletes
//     itself, exactly as before; it does not govern the pool). The pool is
//     bounded to `AUTH_POOL_SIZE` identities and is rebuilt at most once
//     per `POOL_TTL_MS` window, so the worst case is a handful of extra
//     `f126-pool-*@example.com` users per development session, not one
//     per test file per run.
//
// Usage in a migrated file:
//
//   import { poolUserId, getPoolSession, AUTH_POOL_PASSWORD } from
//     "../helpers/auth";
//
//   const ownerId = await poolUserId(0);            // just need the id
//   const viewerSession = await getPoolSession(2);   // need a signed-in client

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

/** Password every pooled identity is created with. */
export const AUTH_POOL_PASSWORD = "Test-password-1!";

/** Number of distinct real users in the pool. Bump if a migrated file
 * needs more simultaneously-distinct actors than this — the largest
 * consumer as of this feature (f002-phase-management.test.ts) needs 6. */
export const AUTH_POOL_SIZE = 10;

// Reuse the same pool across `npm test` invocations that happen within
// this window (comfortably under Supabase's ~1h access-token expiry, so
// `setSession` below almost never needs to refresh — avoiding refresh-token
// rotation entirely). A run that starts after this window simply builds a
// fresh pool; it does not delete the old one (see module doc above).
const POOL_TTL_MS = 15 * 60 * 1000;

const CACHE_PATH = join(tmpdir(), "pm-app-vitest-auth-pool.json");
const LOCK_PATH = `${CACHE_PATH}.lock`;
const LOCK_STALE_MS = 45_000;

interface CachedIdentity {
  id: string;
  email: string;
  access_token: string;
  refresh_token: string;
}

interface CacheFile {
  createdAt: number;
  identities: CachedIdentity[];
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readCacheIfFresh(): CacheFile | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    if (!raw || !Array.isArray(raw.identities) || raw.identities.length < AUTH_POOL_SIZE) {
      return null;
    }
    if (Date.now() - raw.createdAt > POOL_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

async function buildPool(): Promise<CacheFile> {
  if (!SUPABASE_URL || !SECRET_KEY || !PUBLISHABLE_KEY) {
    throw new Error(
      "F126 auth pool: missing Supabase credentials (need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
    );
  }
  const admin = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const identities: CachedIdentity[] = [];
  for (let i = 0; i < AUTH_POOL_SIZE; i++) {
    const email = `f126-pool-${i}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: AUTH_POOL_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`F126 auth pool: failed to create pooled identity ${i}: ${error?.message}`);
    }
    const signInClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
      email,
      password: AUTH_POOL_PASSWORD,
    });
    if (signInError || !signInData.session) {
      throw new Error(
        `F126 auth pool: failed to sign in pooled identity ${i}: ${signInError?.message}`,
      );
    }
    identities.push({
      id: data.user.id,
      email,
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    });
  }
  return { createdAt: Date.now(), identities };
}

async function ensurePool(): Promise<CacheFile> {
  const fresh = readCacheIfFresh();
  if (fresh) return fresh;

  // Exclusive-create races every concurrent vitest worker process here;
  // exactly one of them wins and becomes the "leader" that builds the pool.
  let fd: number | null = null;
  try {
    fd = openSync(LOCK_PATH, "wx");
  } catch {
    fd = null;
  }

  if (fd !== null) {
    try {
      const built = await buildPool();
      writeFileSync(CACHE_PATH, JSON.stringify(built));
      return built;
    } finally {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        /* already gone */
      }
    }
  }

  // Follower: wait for the leader to publish the cache file. If the leader
  // appears to have died mid-build (a stale lock older than
  // LOCK_STALE_MS), reclaim the lock and try to become leader instead.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const nowFresh = readCacheIfFresh();
    if (nowFresh) return nowFresh;
    try {
      const lockAge = Date.now() - statSync(LOCK_PATH).mtimeMs;
      if (lockAge > LOCK_STALE_MS) {
        try {
          unlinkSync(LOCK_PATH);
        } catch {
          /* someone else already reclaimed it */
        }
        return ensurePool();
      }
    } catch {
      // Lock file vanished between our two checks — loop and re-check the
      // cache file; the (former) leader likely just finished.
    }
    await sleep(500);
  }
  throw new Error(
    "F126 auth pool: timed out waiting for another vitest worker to finish building the pool",
  );
}

let poolPromise: Promise<CacheFile> | null = null;

function getPool(): Promise<CacheFile> {
  if (!poolPromise) {
    poolPromise = ensurePool().catch((err) => {
      // Don't cache a rejected promise forever — a transient failure (e.g.
      // a momentary network blip while building the pool) shouldn't poison
      // every subsequent call in this file.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

function assertSlot(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= AUTH_POOL_SIZE) {
    throw new Error(`F126 auth pool: slot must be an integer in [0, ${AUTH_POOL_SIZE}), got ${slot}`);
  }
  return slot;
}

/** The pooled identity's id + email, for callers that only need to seed a
 * `workspace_members` row (no signed-in session required). */
export async function getPoolIdentity(slot: number): Promise<{ id: string; email: string }> {
  const pool = await getPool();
  const identity = pool.identities[assertSlot(slot)];
  return { id: identity.id, email: identity.email };
}

/** Convenience for the common case of just needing the user id (mirrors
 * the `currentTestUserId`-mock pattern used by several migrated files). */
export async function poolUserId(slot: number): Promise<string> {
  return (await getPoolIdentity(slot)).id;
}

/** A signed-in SupabaseClient (publishable key) for the given pool slot,
 * hydrated from a cached session via `setSession` instead of a fresh
 * `signInWithPassword` call. Self-heals once by rebuilding the whole pool
 * if the cached session has gone bad (e.g. a refresh token was consumed by
 * a run outside this TTL window). */
export async function getPoolSession(slot: number): Promise<SupabaseClient> {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    throw new Error("F126 auth pool: missing Supabase credentials for a session client");
  }
  assertSlot(slot);

  const attempt = async (forceRebuild: boolean): Promise<SupabaseClient> => {
    if (forceRebuild) {
      poolPromise = null;
      try {
        unlinkSync(CACHE_PATH);
      } catch {
        /* nothing to remove */
      }
    }
    const pool = await getPool();
    const identity = pool.identities[slot];
    const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await client.auth.setSession({
      access_token: identity.access_token,
      refresh_token: identity.refresh_token,
    });
    if (error) {
      if (!forceRebuild) return attempt(true);
      throw new Error(
        `F126 auth pool: failed to hydrate session for slot ${slot} (${identity.email}): ${error.message}`,
      );
    }
    return client;
  };

  return attempt(false);
}
