import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { resolvePeople } from "@/lib/queries/people";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import { logger } from "@/lib/observability/logger";

// F293 (AS-555, AS-556, AS-557): the second, read-only Route Handler the
// report form (extension/src/popup/report-form.tsx) calls to populate its
// workspace/project/assignee pickers.
//
// AS-557 ("only options the user actually has access to are offered") is a
// real security requirement, not just UX — every row this route can ever
// return is filtered server-side to the caller's own real memberships,
// never a full list trimmed on the client. Concretely:
//   - GET /api/extension/context (no query params): the workspaces the
//     caller is an ACTIVE member of — same `workspace_members` `.eq("user_id",
//     ...).eq("status", "active")` filter `lib/queries/workspaces.ts`'s
//     `getDefaultWorkspaceSlug` already uses for "workspaces I'm a member
//     of" (mirrored here, not reinvented, per this feature's clarification).
//   - GET /api/extension/context?workspaceId=<id>: re-verifies the caller
//     is an active member of THAT workspace via the same
//     `requireActiveMembership()` helper every write path in
//     lib/actions/tasks.ts uses (a caller who is a member of workspace A but
//     not B gets 403 for `?workspaceId=B` — B's projects/members are never
//     read, let alone returned, so there is no data to filter out
//     client-side). On success, returns that workspace's non-deleted
//     projects (mirrors `lib/queries/projects.ts`'s `getWorkspaceProjects`
//     filter) and active members (mirrors `lib/queries/members.ts`'s
//     `getWorkspaceMembers` filter + `resolvePeople` for a display name).
//
// Auth (identity resolution): deliberately DUPLICATED from
// app/api/extension/tasks/route.ts (F292) rather than factored into a
// shared helper — for exactly two routes, a ~25-line block duplicated
// verbatim with a comment pointing at its twin is simpler to read and audit
// than an extra shared-helper module both routes would need to import and
// keep in sync with; if a third extension route is ever added, that's the
// point to factor this out for real. See F292's route for the full
// rationale of *why* this specific approach (anon-key client +
// `auth.getUser(token)`) is used instead of the cookie-based server client.
//
// CORS: same allow-only-the-configured-extension-id policy as F292's route,
// same `EXTENSION_ID` env var, same rationale (see that route's comment).

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = process.env.EXTENSION_ID
    ? `chrome-extension://${process.env.EXTENSION_ID}`
    : null;

  if (!allowedOrigin || origin !== allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = bearerMatch?.[1]?.trim();

  if (!token) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header." },
      { status: 401, headers },
    );
  }

  const authClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Invalid or expired session. Reconnect the extension." },
      { status: 401, headers },
    );
  }

  const admin = createAdminClient();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  if (!workspaceId) {
    // AS-557: only workspaces this caller is an ACTIVE member of — same
    // filter as lib/queries/workspaces.ts's getDefaultWorkspaceSlug.
    const { data: memberships, error: membershipsError } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (membershipsError) {
      logger.error("extension/context: failed to look up memberships", { error: membershipsError });
      return NextResponse.json(
        { error: "Something went wrong. Please try again in a moment." },
        { status: 500, headers },
      );
    }

    const workspaceIds = (memberships ?? []).map((row) => row.workspace_id);
    if (workspaceIds.length === 0) {
      return NextResponse.json({ workspaces: [] }, { status: 200, headers });
    }

    const { data: workspaceRows, error: workspacesError } = await admin
      .from("workspaces")
      .select("id, name, slug")
      .in("id", workspaceIds)
      .order("name", { ascending: true });

    if (workspacesError) {
      logger.error("extension/context: failed to look up workspaces", { error: workspacesError });
      return NextResponse.json(
        { error: "Something went wrong. Please try again in a moment." },
        { status: 500, headers },
      );
    }

    return NextResponse.json(
      { workspaces: workspaceRows ?? [] },
      { status: 200, headers },
    );
  }

  // AS-557: re-verify the caller is an active member of THIS workspace
  // before returning anything scoped to it — a non-member gets 403 and
  // this workspace's projects/members are never queried at all, let alone
  // returned and filtered client-side.
  const membership = await requireActiveMembership(admin, workspaceId, user.id);
  if (!membership.ok) {
    return NextResponse.json(
      { error: "You don't have permission to view this workspace." },
      { status: 403, headers },
    );
  }

  const [{ data: projectRows, error: projectsError }, { data: memberRows, error: membersError }, { data: taskTypeRows, error: taskTypesError }] =
    await Promise.all([
      admin
        .from("projects")
        .select("id, name, visibility")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      admin
        .from("task_types")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true }),
    ]);

  if (projectsError || membersError || taskTypesError) {
    logger.error("extension/context: failed to look up projects/members/task-types", { error: projectsError ?? membersError ?? taskTypesError });
    return NextResponse.json(
      { error: "Something went wrong. Please try again in a moment." },
      { status: 500, headers },
    );
  }

  const memberUserIds = (memberRows ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  const people = await resolvePeople(memberUserIds);

  const members = memberUserIds.map((id) => {
    const person = people.get(id);
    return {
      id,
      name: person?.name ?? person?.email ?? "Unknown",
    };
  });

  // AS-557 (M19 scrutiny BLOCKER-4): `projectRows` above was fetched on the
  // RLS-bypassing admin client, so it includes EVERY project in the
  // workspace, including visibility='private' ones the caller may not be a
  // `project_members` row for. Re-run the same rule
  // `createTaskForUser` (lib/tasks/create.ts) and `uploadAttachmentForUser`
  // (lib/attachments/upload.ts) already enforce via
  // `isProjectVisibleToCaller`, batching the `project_members` lookup into a
  // single query rather than one round trip per private project.
  const allProjectRows = projectRows ?? [];
  const privateProjectIds = allProjectRows
    .filter((row) => ((row.visibility as ProjectVisibility) ?? "workspace") === "private")
    .map((row) => row.id);

  let visiblePrivateProjectIds = new Set<string>();
  if (
    privateProjectIds.length > 0 &&
    membership.role !== "owner" &&
    membership.role !== "admin"
  ) {
    const { data: privateMemberRows, error: privateMemberError } = await admin
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id)
      .in("project_id", privateProjectIds);

    if (privateMemberError) {
      logger.error("extension/context: failed to look up project memberships", { error: privateMemberError });
      return NextResponse.json(
        { error: "Something went wrong. Please try again in a moment." },
        { status: 500, headers },
      );
    }

    visiblePrivateProjectIds = new Set(
      (privateMemberRows ?? []).map((row) => row.project_id),
    );
  }

  // isProjectVisibleToCaller's rule, applied per row using the batched
  // lookup above instead of a per-project query: workspace-visible OR
  // caller is owner/admin OR caller has an explicit project_members row.
  const visibleProjectRows = allProjectRows.filter((row) => {
    const visibility = (row.visibility as ProjectVisibility) ?? "workspace";
    if (visibility === "workspace") return true;
    if (membership.role === "owner" || membership.role === "admin") return true;
    return visiblePrivateProjectIds.has(row.id);
  });

  return NextResponse.json(
    {
      projects: visibleProjectRows.map((row) => ({ id: row.id, name: row.name })),
      members,
      taskTypes: (taskTypeRows ?? []).map((row) => ({ id: row.id, name: row.name })),
    },
    { status: 200, headers },
  );
}
