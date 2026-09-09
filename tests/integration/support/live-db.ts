// Shared helpers for the isolation suites in tests/integration/*-isolation.test.ts
// that run against the real linked Supabase project.
//
// F031 (M1 second review, Part B): these suites used to run automatically
// whenever `.env` happened to hold admin credentials — which, since `.env`
// here symlinks to the user's main checkout, meant an ordinary `npm test`
// was seeding real users and workspaces into the user's live hosted
// Supabase project. `AI_DOCS_LIVE_DB_TESTS=1` is now required as an
// explicit opt-in on top of having credentials, so these suites never run
// by accident. The one exception is CI: CI must not be able to go green
// while silently skipping all real coverage, so CI with credentials
// present still runs the suites even without the opt-in var.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";

export function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
export const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

// Explicit opt-in required to actually seed the linked project locally.
// CI is exempt from needing the opt-in (see the hard-throw below) so it
// can never go green while silently skipping every real-DB assertion.
const liveDbOptIn = process.env.AI_DOCS_LIVE_DB_TESTS === "1";

if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F024: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Whether the live-DB suites should actually run: creds must be present,
// and either the caller opted in explicitly or we're in CI (where the
// hard-throw above already guarantees creds exist).
export const shouldRunLiveDbTests = haveAdminCreds && (liveDbOptIn || Boolean(process.env.CI));

/**
 * Deletes anything in the linked project matching the given fixture-name
 * prefixes (e.g. "f024-", "f027-"), regardless of how far a `beforeAll`
 * got before throwing. Safe to call even if nothing matches. Never
 * touches rows that don't match one of the prefixes, so it never deletes
 * data this test run didn't create the naming convention for.
 */
export async function sweepLeakedFixtures(
  adminClient: SupabaseClient,
  prefixes: string[],
): Promise<{ deletedWorkspaces: string[]; deletedUsers: string[] }> {
  const deletedWorkspaces: string[] = [];
  const deletedUsers: string[] = [];

  // Workspaces: slug starts with one of the prefixes.
  for (const prefix of prefixes) {
    const { data: workspaces } = await adminClient
      .from("workspaces")
      .select("id, slug")
      .like("slug", `${prefix}%`);
    for (const ws of workspaces ?? []) {
      await adminClient.from("docs").delete().eq("workspace_id", ws.id);
      await adminClient.from("workspace_members").delete().eq("workspace_id", ws.id);
      await adminClient.from("workspaces").delete().eq("id", ws.id);
      deletedWorkspaces.push(ws.id as string);
    }
  }

  // Auth users: email local-part starts with one of the prefixes.
  // admin.listUsers is paginated; walk all pages defensively.
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error || !data) break;
    for (const u of data.users) {
      const email = u.email ?? "";
      if (prefixes.some((prefix) => email.startsWith(prefix))) {
        await adminClient.auth.admin.deleteUser(u.id);
        deletedUsers.push(u.id);
      }
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  return { deletedWorkspaces, deletedUsers };
}

export function createAdminClient(): SupabaseClient {
  return createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
