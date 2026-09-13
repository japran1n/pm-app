import { cache } from "react";

import { logger } from "@/lib/observability/logger";
import { getRequestClient } from "@/lib/auth/current-user";

// Shared "default workspace" lookup (AS-005 / AS-003 adjacent).
//
// Both the auth callback route (app/(auth)/auth/callback/route.ts) and the
// onboarding page (app/(workspace)/onboarding/page.tsx) need to answer the
// same question: does this signed-in user already have an active workspace
// membership, and if so, which workspace should they land on? Extracted
// here so the "pick the most-recently-created active membership" rule is
// defined in exactly one place instead of drifting between the two
// call sites.
//
// Takes the caller's RLS-respecting client (not the admin client) — this
// is a read of the current user's own membership/workspace rows, which RLS
// already permits, so there's no reason to bypass it here.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getDefaultWorkspaceSlug(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | undefined> {
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    logger.error("getDefaultWorkspaceSlug: failed to look up workspace memberships", { error: membershipError });
  }

  if (!membership) {
    return undefined;
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("slug")
    .eq("id", membership.workspace_id)
    .maybeSingle();

  if (workspaceError) {
    logger.error("getDefaultWorkspaceSlug: failed to look up workspace slug", { error: workspaceError });
  }

  return workspace?.slug ?? undefined;
}

// F002 (mission 20260913-perf-latency, AS-002): request-scoped memoised
// workspace-by-slug lookup.
//
// The audit for this mission found `workspaces` looked up by slug up to
// THIRTEEN times across a single nested-route request (the workspace
// layout, the project layout, the docs layout(s), the chat layout, and
// every leaf page under them each ran their own
// `.from("workspaces").select(...).eq("slug", workspaceSlug).maybeSingle()`),
// each one a 97-221ms Supabase round trip. `cache()` collapses all of those
// to one query per request, the same pattern F001's `getCurrentUser`/
// `getRequestClient` established for the identity lookup.
//
// Column shape: callers select different subsets today —
// `id` only (docs/chat layouts), `id, name` (project layout, some pages),
// and `id, name, slug, logo_url` (the top-level workspace layout, which
// also needs `slug`/`logo_url` for the switcher and slug-history redirect
// comparison). This helper selects the UNION of every column any existing
// call site reads (`id, name, slug, logo_url`) so every caller can swap in
// this function for its own query without changing what it reads — a
// caller that only wants `id` just ignores the extra fields on the
// returned row, same as any other `select("*")`-shaped result would.
//
// Deliberately does NOT include the `workspace_slug_history` fallback
// lookup that the top-level workspace layout performs when this query
// returns null. That branch is a *redirect decision* (permanentRedirect to
// the workspace's current slug for a since-renamed slug), not a "resolve
// the workspace" concern — every other call site (project layout, docs
// layout, chat layout, leaf pages) that also queries by slug does NOT
// perform a slug-history fallback today, and folding it into this shared
// helper would change their behaviour: a stale/renamed slug hit on, say,
// the docs layout would start silently redirecting where today it 404s
// (or vice versa, if the redirect fired somewhere the page never expected
// a redirect to happen). AS-025 forbids exactly that kind of behaviour
// change. So: this helper answers "does a workspace exist at this slug,
// and what are its core columns", full stop. The one caller that also
// needs the slug-history redirect (the top-level workspace layout) keeps
// that follow-up query as its own call-site logic when F003 wires it in,
// unchanged from what it does today.
//
// `cache()`-wrapped for the same reason as `getCurrentUser`/
// `getRequestClient` (lib/auth/current-user.ts): React's `cache()`
// memoises per Server Component render/request under the real Next.js
// runtime and never leaks between requests or users — see that file's own
// header comment for the full reasoning, and tech-decisions.md's "Request
// -scoped memoisation" section. Under plain Vitest there is no per-request
// cache dispatcher, so this does not memoise inside a unit test (see that
// same file's note, and this feature's test file for why the test here is
// structural rather than a call-count assertion).
export const getWorkspaceBySlug = cache(async function getWorkspaceBySlug(
  slug: string,
) {
  const supabase = await getRequestClient();
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, name, slug, logo_url")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    logger.error("getWorkspaceBySlug: failed to look up workspace by slug", { error });
  }

  return workspace;
});
