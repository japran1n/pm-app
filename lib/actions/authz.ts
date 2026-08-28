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

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        error: options.notSignedInError ?? "You must be signed in.",
      };
    }

    const admin = createAdminClient();

    const resolved = await options.resolveWorkspace(parsed.data, admin);

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
