// F140: `writeAudit()` — the single call site every workspace, project,
// member, invite, and role-mutation Server Action uses to record an
// `audit_log` entry (AS-245).
//
// Thin wrapper around the `write_audit_log_entry` SECURITY DEFINER RPC
// shipped by F139 (supabase/migrations/20260821211226_create_audit_log.sql).
// See lib/activity/README.md for the `action` naming convention
// (`<subject>.<past_tense_verb>[_<qualifier>]`) every caller must follow.
//
// Client choice: the RPC pins `actor_id` server-side to `auth.uid()` and
// re-checks the caller is an active member of the target workspace — both
// only work when called through a session-bound client (the request-scoped
// client from `lib/supabase/server`'s `createClient()`), never the
// service-role admin client (which has no `auth.uid()` and would make every
// call fail with "no authenticated actor"). Every caller of `writeAudit()`
// must pass the same session client it already uses for its own
// `supabase.auth.getUser()` check.
//
// Failure handling (per this feature's clarified spec): a failed audit
// write is logged via `console.error` and otherwise swallowed — it is a
// side effect of the real action, not a precondition for it, matching the
// existing non-fatal `revalidatePath` failure convention used throughout
// lib/actions/*.ts (see e.g. `inviteMember`'s `revalidatePath` try/catch in
// lib/actions/workspaces.ts). `writeAudit()` never throws and never returns
// an error the caller has to check.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

export interface WriteAuditParams {
  workspaceId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  supabase: SupabaseClient<Database>,
  params: WriteAuditParams,
): Promise<void> {
  const { workspaceId, action, targetType, targetId, metadata } = params;

  try {
    const { error } = await supabase.rpc("write_audit_log_entry", {
      p_workspace_id: workspaceId,
      p_action: action,
      p_target_type: targetType,
      // The database function accepts a nullable `target_id uuid` (see the
      // migration's SQL signature); the generated RPC Args type is
      // (imprecisely) non-optional `string`, so a `null` target is cast
      // through here rather than widening the public `WriteAuditParams`
      // shape to satisfy a generated-type quirk.
      p_target_id: (targetId ?? null) as unknown as string,
      p_metadata: (metadata ?? {}) as Json,
    });

    if (error) {
      console.error("writeAudit: write_audit_log_entry RPC failed:", {
        action,
        targetType,
        error,
      });
    }
  } catch (unexpectedError) {
    // Same non-fatal rationale as the revalidatePath try/catch convention
    // elsewhere in this codebase: an audit write must never fail the
    // caller's real action, including on an unexpected throw (e.g. no
    // request/session context at all).
    console.error("writeAudit: unexpected failure (non-fatal):", {
      action,
      targetType,
      unexpectedError,
    });
  }
}
