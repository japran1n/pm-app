import { redirect } from "next/navigation";

import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canViewAudit} from "@/lib/auth/permissions";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  KNOWN_AUDIT_ACTIONS,
  getAuditLogPage,
} from "@/lib/queries/audit";
import { logger } from "@/lib/observability/logger";
import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditTable } from "@/components/audit/audit-table";

// F141 (AS-246, AS-248): workspace audit log page.
//
// Access (AS-246): "readable by owners and admins only" is already
// enforced at the RLS layer (F139's `audit_log_select_owner_admin` —
// a member/viewer/guest's direct query returns zero rows, not an error).
// This page additionally gates itself *before* even attempting the query
// — same pattern F134's members page uses with `canViewMembersList`
// (redirect away, not just hide UI) — via `canViewAudit`
// (lib/auth/permissions.ts), which already existed (added alongside
// F139's RLS policy so the DB and app layers can't drift, per that
// feature's own handoff). A member/viewer/guest hitting this URL directly
// is redirected before any `audit_log` query runs.
//
// Bounded window + filters (AS-248): `searchParams` (Next 16: async, per
// tech-decisions.md — same convention as the List view's `ListFilters`)
// carries `actorId`, `action`, and `limit`; `getAuditLogPage` re-fetches a
// single bounded window on every combination change, same round-trip-
// through-the-URL approach as `components/task/list-filters.tsx`.
export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    actorId?: string;
    action?: string;
    limit?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;

  // ARCH-001: caller identity, the workspace-by-slug lookup, and the
  // caller's own membership role all come from the shared cached helper
  // (lib/queries/workspaces.ts) instead of three per-page queries.
  const ctx = await getWorkspaceContext(workspaceSlug);

  if (!ctx.user) {
    redirect("/sign-in");
  }

  // Defensive fallback only — the layout guard above already redirects
  // away when the workspace can't be resolved for this caller.
  if (!ctx.workspace) {
    redirect("/onboarding");
  }

  const { workspace, role } = ctx;

  // AS-246: page-level gate, evaluated before the audit_log query runs.
  if (!canViewAudit({ role })) {
    redirect(`/w/${workspaceSlug}`);
  }

  const actorIdParam = resolvedSearchParams.actorId || undefined;
  const actionParam = resolvedSearchParams.action || undefined;
  const parsedLimit = Number.parseInt(resolvedSearchParams.limit ?? "", 10);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 1000)
      : DEFAULT_AUDIT_PAGE_SIZE;

  let auditPage: Awaited<ReturnType<typeof getAuditLogPage>> | null = null;
  let loadError = false;

  try {
    auditPage = await getAuditLogPage(
      workspace.id,
      { actorId: actorIdParam, action: actionParam },
      limit,
    );
  } catch (error) {
    logger.error("AuditLogPage: failed to load audit log", { error: error });
    loadError = true;
  }

  // Actor filter options: this workspace's active members (F134/F122's
  // existing `getWorkspaceMembers` — already resolves display name/email/
  // avatar in one batched call, same source the members page's own
  // pickers use). A past actor who has since left the workspace won't
  // appear as a selectable filter option, but their existing entries
  // still render fine in the table (actor display data is resolved
  // per-row by `resolvePeople`, independent of current membership).
  let actorOptions: { id: string; label: string; avatarUrl?: string | null }[] =
    [];
  try {
    const members = await getWorkspaceMembers(workspace.id);
    actorOptions = members.active.map((member) => ({
      id: member.userId,
      label: member.name ?? member.email ?? member.userId,
      avatarUrl: member.avatarUrl,
    }));
  } catch (error) {
    logger.error("AuditLogPage: failed to load actor filter options", { error: error });
  }

  const actionOptions = KNOWN_AUDIT_ACTIONS.map((action) => ({
    value: action,
    label: action,
  }));

  const loadMoreParams = new URLSearchParams();
  if (actorIdParam) loadMoreParams.set("actorId", actorIdParam);
  if (actionParam) loadMoreParams.set("action", actionParam);
  loadMoreParams.set("limit", String(limit + DEFAULT_AUDIT_PAGE_SIZE));
  const loadMoreHref = `/w/${workspaceSlug}/settings/audit?${loadMoreParams.toString()}`;

  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Sensitive activity for {workspace.name}, most recent first.
        </p>
      </div>

      <AuditFilters actorOptions={actorOptions} actionOptions={actionOptions} />

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading the audit log. Please try again.</p>
          <a href={`/w/${workspaceSlug}/settings/audit`} className="underline">
            Retry
          </a>
        </div>
      )}

      {auditPage && (
        <AuditTable
          workspaceSlug={workspaceSlug}
          rows={auditPage.rows}
          hasMore={auditPage.hasMore}
          loadMoreHref={loadMoreHref}
          hasActiveFilters={Boolean(actorIdParam || actionParam)}
        />
      )}
    </div>
  );
}
