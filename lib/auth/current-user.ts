// F001 (mission 20260913-perf-latency, AS-003): the single request-scoped
// identity resolver for the whole app. Before this file existed,
// `lib/actions/authz.ts` had its own private `cache()`-wrapped
// `getAuthenticatedUser`, and every layout/query helper that needed "who is
// the caller" built its own `createClient()` and called
// `supabase.auth.getUser()` again -- measured at 97-221ms per call, mean
// 139ms, with up to twelve calls on a single workspace-page request (see
// tech-decisions.md "Why the auth call is a network call"). This file is
// now the ONLY `cache()`-wrapped identity resolver in the codebase;
// `lib/actions/authz.ts` imports `getCurrentUser` from here instead of
// declaring its own.
//
// Why `cache()` is safe here: `cache()` memoises per render/request in the
// Next.js Server Component and Server Action runtime -- it never survives
// past the request that created it and never leaks between two different
// users' requests (see tech-decisions.md "Request-scoped memoisation: React
// `cache()`" for the full reasoning on why `unstable_cache`/`"use cache"`
// are the wrong tools for this).
//
// Why this still calls `getUser()` and not `getSession()`: `getSession()`
// reads the (possibly stale, unverified) session from the cookie/local
// storage without checking with the Supabase Auth server, so a forged or
// stale cookie would be trusted. `getUser()` always revalidates the token
// against the Auth server. Caching a verified `getUser()` result for the
// lifetime of one request is safe; swapping it for `getSession()` to save
// the network call would silently remove that verification, which this
// mission does not do (tech-decisions.md is explicit that no auth path
// trades `getUser` for `getSession` or `getClaims`).
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

// Shared per-request Supabase client. Exported so call sites that need the
// client (not just the user) can reuse the same instance instead of
// constructing their own with `createClient()`.
export const getRequestClient = cache(async function getRequestClient() {
  return createClient();
});

// Shared per-request identity resolution. Returns the same shape
// `lib/actions/authz.ts` already relied on (`{ supabase, user }`) so it is
// a drop-in for every existing caller of the old private
// `getAuthenticatedUser`.
export const getCurrentUser = cache(async function getCurrentUser() {
  const supabase = await getRequestClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});
