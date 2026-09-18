// W11 (mission 20260828-hardening, finding #5/#15): a single, enforceable
// authorization seam. Before this file existed, ~90 lines of
// Zod-parse -> getUser -> admin client -> load task row -> resolve
// workspace -> requireActiveMembership -> (optional) write-role gate ->
// (optional) isProjectVisibleToCaller were hand-copied at the top of every
// action in lib/actions/tasks.ts (16x in that file alone, ~40x across the
// codebase). `withAuthz` runs that whole pipeline exactly once so the
// invariant is checkable in one place instead of forty.
//
// Deliberately NOT a rewrite of the underlying access model: this wraps
// the exact same helpers (`requireActiveMembership`, `canWrite`,
// `isProjectVisibleToCaller`) every hand-written preamble already called,
// in the exact same order, with the exact same "who resolves the
// workspace/project" responsibility left to the caller (via
// `resolveWorkspace`) — because different actions load different columns
// and use different "is this task findable" filters (e.g. restoreTask
// requires `deleted_at IS NOT NULL`, the rest require `IS NULL`). Moving
// the admin client's `.from("tasks")...` query into resolveWorkspace keeps
// each action's own row shape and not-found semantics intact while still
// centralizing every AUTH decision (membership, write gate, visibility).
import type { User, SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import {
  canWrite,
  type PermissionContext,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";

type AdminClient = ReturnType<typeof createAdminClient>;

// Whatever an action's own resolveWorkspace step already looked up (e.g.
// the task row) that its handler body needs later, without a second query.
// Defaults to an empty object for actions that need nothing beyond
// workspaceId/projectId/visibility.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AuthzExtra = {};

export type AuthzContext<TExtra extends AuthzExtra = AuthzExtra> = {
  user: User;
  admin: AdminClient;
  supabase: SupabaseClient;
  workspaceId: string;
  role: WorkspaceRole;
  projectId?: string;
  visibility?: ProjectVisibility;
} & TExtra;

export type ResolveWorkspaceResult<TExtra extends AuthzExtra = AuthzExtra> =
  | {
      ok: true;
      workspaceId: string;
      projectId?: string;
      visibility?: ProjectVisibility;
      // Nested (not spread) deliberately: keeping this in its own field
      // (rather than intersecting `TExtra` directly into the `ok: true`
      // branch) keeps this a clean discriminated union on `ok`, so TS can
      // reliably infer `TExtra` from a resolveWorkspace implementation's
      // return statements at every call site.
      extra: TExtra;
    }
  | { ok: false; error: string };

export type AuthzOptions<TInput, TExtra extends AuthzExtra = AuthzExtra> = {
  // Default false. When true, gates the caller with `canWrite({ role })`
  // (or `writeCheck`, if supplied) after membership is confirmed but
  // before the handler runs.
  requireWrite?: boolean;
  // Overrides the default `canWrite` predicate (e.g. `canEditTask` for
  // actions that gate write access more narrowly than a plain write).
  writeCheck?: (ctx: PermissionContext) => boolean;
  // Default false. When true, `resolveWorkspace` must return `projectId`
  // and `visibility`, and the caller must additionally pass
  // `isProjectVisibleToCaller` (F322 read/write confidentiality) before the
  // handler runs.
  requireVisibility?: boolean;
  notSignedInError?: string;
  membershipError?: string;
  writeError?: string;
  visibilityError?: string;
  // Resolves (and, per-action, loads/validates) the workspace the caller
  // is targeting. Runs with the admin client so it can look past RLS to
  // decide "not found" vs "found but not authorized" the same way every
  // hand-written preamble already did. Anything this returns beyond
  // workspaceId/projectId/visibility is threaded through untouched as
  // `TExtra` on the handler's context (e.g. a loaded task row), so the
  // handler never has to re-query.
  resolveWorkspace: (
    input: TInput,
    admin: AdminClient,
  ) => Promise<ResolveWorkspaceResult<TExtra>>;
};

export type AuthzFailure = { ok: false; error: string };

// ARCH-011: the one generic result shape behind lib/actions' many bespoke
// `*Result` aliases. Domain aliases keep their names (and stay exported)
// at each action's definition site; they just point here now instead of
// re-spelling the same discriminated union.
//
// `ActionResult<T>` is for actions that return their payload under a
// `data` field; `ActionOutcome<TSuccess>` is for the (more common) actions
// that spread success fields at the top level next to `ok: true` — with no
// type argument it is exactly `{ ok: true } | { ok: false; error: string }`.
export type ActionResult<T> = { ok: true; data: T } | AuthzFailure;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ActionOutcome<TSuccess extends object = {}> =
  | ({ ok: true } & TSuccess)
  | AuthzFailure;

// F124 (AS-081, AS-083, AS-085): every `withAuthz`-wrapped action used to
// pay two, fully sequential, unconditional network round trips before its
// own resolveWorkspace step even started: createClient() (reads request
// cookies, cheap) followed by an AWAITED `supabase.auth.getUser()` (a real
// call to Supabase Auth that verifies the JWT). Two independent fixes,
// deliberately no further than that:
//
// 1. `cache()` — React's per-request memoization primitive, the exact one
//    lib/queries/projects.ts's `getProjectById` already uses. If more than
//    one call site in the SAME request resolves identity through this
//    function, only the first pays the network round trip; later calls in
//    that request get the memoized `{ supabase, user }` pair instead of a
//    second `getUser()` call. `cache()` is per-request by construction —
//    not a concern that needs a manual invalidation/reset here — because
//    of how it's implemented: `cache()` closes over React's *current
//    dispatcher* (`ReactSharedInternals.A`), which Next.js's own
//    react-server runtime swaps to a fresh one for every request/action
//    invocation it processes (this is the same mechanism that scopes
//    `fetch()` deduplication and the framework's own per-request caches);
//    if no such dispatcher is active (e.g. this file under a plain
//    Vitest unit test, which never goes through Next's request runtime),
//    `cache()`'s own fallback in that case is to skip memoization
//    entirely and just call the wrapped function directly every time —
//    confirmed by reading both react-server and non-react-server builds
//    of `cache()` in node_modules/react: the failure mode of "no active
//    per-request dispatcher" is "memoize nothing, ever" (identical to
//    this code before this change), never "reuse a stale value from a
//    different request." There is no code path here that reads or writes
//    any state keyed by anything OTHER than that per-request dispatcher,
//    so a value produced for user A's request can only ever be handed
//    back to a call made against that same dispatcher, i.e. the same
//    request. See this feature's handoff for how this was exercised
//    against the real dev server to double-check the isolation claim
//    empirically, not just by reading the source.
// 2. Still calls `getUser()`, never `getSession()` (AS-084) —
//    `getSession()` reads the cookie payload without verifying it against
//    Supabase Auth, which is exactly the vulnerability this file's own
//    header comment (W11) exists to centralize a defense against. Caching
//    the RESULT of a verified call is not the same thing as skipping
//    verification, and this change never does the latter.
// F001 (mission 20260913-perf-latency, AS-003): moved to
// lib/auth/current-user.ts so every call site in the app (not just this
// file's `withAuthz`) shares the same `cache()`-wrapped resolver instead of
// each declaring its own. Re-bound to the old local name so the rest of
// this file (and its reasoning above) needs no further changes.
const getAuthenticatedUser = getCurrentUser;

// Wraps `handler` with the standard auth pipeline. Returns a function that
// takes the RAW (unparsed) input a Server Action received, so a thin
// wrapper function preserving the action's original public signature can
// just forward its positional arguments as an object literal — see
// lib/actions/tasks.ts's migrated actions for the pattern.
export function withAuthz<
  TInput,
  TOutput extends { ok: boolean },
  TExtra extends AuthzExtra = AuthzExtra,
>(
  schema: ZodType<TInput>,
  options: AuthzOptions<TInput, TExtra>,
  handler: (input: TInput, ctx: AuthzContext<TExtra>) => Promise<TOutput>,
): (rawInput: unknown) => Promise<TOutput | AuthzFailure> {
  return async (rawInput: unknown) => {
    const parsed = schema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
    }

    // F124 (AS-081): identity resolution (step 1) and workspace resolution
    // (step 2) are independent — `resolveWorkspace` takes only `parsed.data`
    // and `admin`, never `user` — so they run concurrently instead of one
    // after the other. `admin` is a plain client-object construction (no
    // I/O — see lib/supabase/admin.ts), so building it before the
    // `Promise.all` doesn't reintroduce a sequential wait.
    //
    // Precedence when BOTH fail, decided deliberately rather than left to
    // fall out of Promise.all's ordering (which reports whichever
    // constituent settles, not a fixed "first argument wins" rule): the
    // `!user` check runs FIRST, exactly matching this function's
    // pre-F124 behavior, where `resolveWorkspace` was never even called
    // (let alone allowed to fail) until AFTER the signed-in check passed.
    // A signed-out caller against a nonexistent/foreign workspace still
    // gets `notSignedInError`, byte-for-byte the same as before (AS-082).
    // eslint-disable-next-line no-restricted-syntax -- ARCH-003: this is the withAuthz seam itself constructing ctx.admin from scratch; there is no earlier auth check to defer to because this call site IS where ctx.admin originates for every other action in this codebase
    const admin = createAdminClient();

    const [{ supabase, user }, resolved] = await Promise.all([
      getAuthenticatedUser(),
      options.resolveWorkspace(parsed.data, admin),
    ]);

    if (!user) {
      return {
        ok: false,
        error: options.notSignedInError ?? "You must be signed in.",
      };
    }

    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const membership = await requireActiveMembership(
      admin,
      resolved.workspaceId,
      user.id,
    );

    if (!membership.ok) {
      return {
        ok: false,
        error:
          options.membershipError ??
          "You don't have permission to do this.",
      };
    }

    if (options.requireWrite) {
      const writeCheck = options.writeCheck ?? canWrite;
      if (!writeCheck({ role: membership.role })) {
        return {
          ok: false,
          error:
            options.writeError ?? "You don't have permission to do this.",
        };
      }
    }

    if (options.requireVisibility) {
      if (!resolved.projectId || !resolved.visibility) {
        return { ok: false, error: "Task not found." };
      }

      const visible = await isProjectVisibleToCaller(
        admin,
        { projectId: resolved.projectId, visibility: resolved.visibility },
        user.id,
        membership.role,
      );

      if (!visible) {
        return {
          ok: false,
          error:
            options.visibilityError ??
            "You don't have permission to do this.",
        };
      }
    }

    const ctx = {
      user,
      admin,
      supabase,
      workspaceId: resolved.workspaceId,
      role: membership.role,
      projectId: resolved.projectId,
      visibility: resolved.visibility,
      ...resolved.extra,
    } as AuthzContext<TExtra>;

    return handler(parsed.data, ctx);
  };
}
