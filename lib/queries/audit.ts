// F141: workspace audit log query + the single action-to-sentence mapping
// (AS-246, AS-248).
//
// The clarified spec's Notes ("Action strings must render as sentences,
// not raw keys — keep the mapping in one place") is satisfied by putting
// both the data-fetch AND the `action` -> human-readable sentence /
// target-link logic in this one file. `components/audit/audit-table.tsx`
// imports `actionSentence`/`targetHref` from here rather than
// re-implementing any part of the mapping — there is exactly one source
// of truth for what an `audit_log.action` string means.
//
// Read access: this file makes no attempt to re-check owner/admin role
// itself — the RLS policy `audit_log_select_owner_admin` (F139) already
// rejects a non-owner/admin's direct query with an empty result set, and
// the calling page additionally gates page access via `canViewAudit`
// (lib/auth/permissions.ts) before this function is ever called, mirroring
// the members page's `canViewMembersList` pattern (F134). Belt and
// suspenders, not a substitute for either layer.
//
// Bounded window (clarified spec: "most recent 100 rows... not an
// unbounded query"): `limit` defaults to 100 and the caller can request a
// larger window (the page bumps it by 100 via a "Load more" control) —
// this always re-runs a single bounded query for "the N most recent rows
// matching the filters," never an unbounded `select *`.

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";

export const DEFAULT_AUDIT_PAGE_SIZE = 100;

// Every `action` value written by F140's `writeAudit` call sites, kept in
// sync with `lib/activity/README.md`'s naming convention doc and grepped
// against `lib/actions/*.ts` at the time this feature was built. Used to
// populate the "action type" filter's option list (AS-248) without an
// extra `select distinct` query, and as the fallback lookup key for
// `actionSentence` below. A future action not in this list still renders
// (via the generic fallback sentence) — it just won't appear pre-listed
// in the filter dropdown until this list is extended.
export const KNOWN_AUDIT_ACTIONS = [
  "member.invited",
  "invite.revoked",
  "invite.accepted",
  "member.role_changed",
  "member.removed",
  "workspace.deleted",
  "workspace.renamed",
  "workspace.slug_changed",
  "project.created",
  "project.updated",
  "project.archived",
  "project_member.added",
  "project_member.removed",
  "project.visibility_changed",
] as const;

export type KnownAuditAction = (typeof KNOWN_AUDIT_ACTIONS)[number];

export type AuditLogRow = {
  id: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  actorAvatarUrl: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  hasMore: boolean;
};

export type AuditLogFilters = {
  actorId?: string | null;
  action?: string | null;
};

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

/**
 * The single action-string -> human-readable sentence mapping (clarified
 * spec's explicit requirement). Takes the already-resolved actor label
 * (see `personLabel` in components/user-avatar.tsx) so this stays a pure
 * function of already-loaded data — no extra DB lookups for the sentence
 * itself, since every action's `metadata` jsonb already carries what it
 * needs (F140's convention: "put any additional structured detail ...
 * in metadata").
 */
export function actionSentence(row: {
  action: string;
  actorLabel: string;
  metadata: Record<string, unknown>;
}): string {
  const { action, actorLabel, metadata } = row;

  switch (action) {
    case "member.invited": {
      const email = metadataString(metadata, "email") ?? "someone";
      const role = metadataString(metadata, "role") ?? "member";
      return `${actorLabel} invited ${email} as ${role}`;
    }
    case "invite.revoked":
      return `${actorLabel} revoked a pending invite`;
    case "invite.accepted": {
      const role = metadataString(metadata, "role") ?? "member";
      return `${actorLabel} accepted an invite and joined as ${role}`;
    }
    case "member.role_changed": {
      const oldRole = metadataString(metadata, "old_role") ?? "a previous role";
      const newRole = metadataString(metadata, "new_role") ?? "a new role";
      return `${actorLabel} changed a member's role from ${oldRole} to ${newRole}`;
    }
    case "member.removed": {
      const role = metadataString(metadata, "role");
      return role
        ? `${actorLabel} removed a member (was ${role})`
        : `${actorLabel} removed a member`;
    }
    case "workspace.deleted":
      return `${actorLabel} deleted the workspace`;
    case "workspace.renamed": {
      const name = metadataString(metadata, "name");
      return name
        ? `${actorLabel} renamed the workspace to "${name}"`
        : `${actorLabel} renamed the workspace`;
    }
    case "workspace.slug_changed": {
      const oldSlug = metadataString(metadata, "old_slug");
      const newSlug = metadataString(metadata, "new_slug");
      return oldSlug && newSlug
        ? `${actorLabel} changed the workspace URL from ${oldSlug} to ${newSlug}`
        : `${actorLabel} changed the workspace URL`;
    }
    case "project.created": {
      const name = metadataString(metadata, "name");
      return name
        ? `${actorLabel} created the project "${name}"`
        : `${actorLabel} created a project`;
    }
    case "project.updated": {
      const fields = metadata["fields"];
      const fieldList =
        Array.isArray(fields) && fields.length > 0
          ? fields.filter((f): f is string => typeof f === "string").join(", ")
          : null;
      return fieldList
        ? `${actorLabel} updated the project (${fieldList})`
        : `${actorLabel} updated a project`;
    }
    case "project.archived":
      return `${actorLabel} archived a project`;
    case "project_member.added": {
      const role = metadataString(metadata, "project_role") ?? "member";
      return `${actorLabel} added a member to a project as ${role}`;
    }
    case "project_member.removed":
      return `${actorLabel} removed a member from a project`;
    case "project.visibility_changed": {
      const visibility = metadataString(metadata, "visibility") ?? "a new value";
      return `${actorLabel} changed a project's visibility to ${visibility}`;
    }
    default:
      // Fallback for any action string not (yet) in KNOWN_AUDIT_ACTIONS —
      // still a sentence, never a raw dotted key rendered verbatim.
      return `${actorLabel} performed "${action}"`;
  }
}

/**
 * Best-effort link to the entity an entry targeted, given the workspace
 * slug the audit page is already rendering under. Returns null when no
 * sensible deep link exists (e.g. a removed project_member row has
 * nothing left to link to beyond the project it belonged to).
 */
export function targetHref(
  workspaceSlug: string,
  row: Pick<AuditLogRow, "targetType" | "targetId" | "metadata">,
): string | null {
  switch (row.targetType) {
    case "project":
      return row.targetId
        ? `/w/${workspaceSlug}/projects/${row.targetId}`
        : null;
    case "workspace":
      return `/w/${workspaceSlug}/settings`;
    case "workspace_member":
      return `/w/${workspaceSlug}/settings/members`;
    case "project_member": {
      const projectId = metadataString(row.metadata, "project_id");
      return projectId ? `/w/${workspaceSlug}/projects/${projectId}` : null;
    }
    default:
      return null;
  }
}

/**
 * Fetches a bounded, reverse-chronological window of `audit_log` rows for
 * a workspace, optionally filtered by actor and/or action (AS-248), with
 * actor display data resolved via the same batched `resolvePeople` helper
 * every other person-rendering call site uses (F122).
 *
 * Uses the caller's session-bound client, not the admin client — reads
 * rely entirely on `audit_log_select_owner_admin` RLS (F139/AS-247) to
 * enforce owner/admin-only access at the database layer; this function
 * does not widen visibility beyond what that policy already grants the
 * calling session.
 */
export async function getAuditLogPage(
  workspaceId: string,
  filters: AuditLogFilters = {},
  limit: number = DEFAULT_AUDIT_PAGE_SIZE,
): Promise<AuditLogPage> {
  const supabase = await createClient();

  let query = supabase
    .from("audit_log")
    .select("id, actor_id, action, target_type, target_id, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    // Fetch one extra row to detect "there are more beyond this window"
    // without a separate count query.
    .limit(limit + 1);

  if (filters.actorId) {
    query = query.eq("actor_id", filters.actorId);
  }
  if (filters.action) {
    query = query.eq("action", filters.action);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getAuditLogPage: fetch failed:", error);
    throw error;
  }

  const allRows = data ?? [];
  const hasMore = allRows.length > limit;
  const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

  const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
  const people = await resolvePeople(actorIds);

  const rows: AuditLogRow[] = pageRows.map((row) => {
    const person = people.get(row.actor_id);
    return {
      id: row.id,
      actorId: row.actor_id,
      actorName: person?.name ?? null,
      actorEmail: person?.email ?? null,
      actorAvatarUrl: person?.avatarUrl ?? null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  });

  return { rows, hasMore };
}
