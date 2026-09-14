import { NextResponse, type NextRequest } from "next/server";

import {
  extensionOptions,
  withExtensionAuth,
  type ExtensionAuthContext,
} from "@/lib/api/extension-auth";
import { requireActiveMembership } from "@/lib/auth/require-membership";
// F336 (security, identical class to M17 scrutiny BLOCKER-3/F334):
// createTaskForUser now lives in a plain module with no "use server"
// directive, so it is reachable only via a real import, never as a
// network-addressable Server Action endpoint. See lib/tasks/create.ts's
// header comment for the full rationale.
import { createTaskForUser } from "@/lib/tasks/create";
import { extensionCreateTaskSchema } from "@/lib/validation/extension";
import { formatTaskKey } from "@/lib/tasks/task-key";

// F292 (AS-558, AS-561, AS-562, AS-572): the ONE narrow authenticated Route
// Handler the QA feedback browser extension calls to create a real task
// from a captured report. This is explicitly NOT a general public API —
// tech-decisions.md's "QA feedback extension" section and this feature's
// spec both say a general public API was cut from this mission's scope.
// Only this one endpoint, only this one shape.
//
// Security model:
//  - Identity (AS-561), token validity (AS-572), CORS (EXTENSION_ID-scoped
//    single Origin), and rate limiting (audit ARCH-007: 60 creates per
//    user per hour) are all handled by the shared withExtensionAuth
//    wrapper — see lib/api/extension-auth.ts's header for the full,
//    previously-triplicated rationale (audit ARCH-008).
//  - Membership (AS-562): re-verified server-side via the SAME
//    requireActiveMembership() helper lib/actions/tasks.ts's own
//    createTask() Server Action uses — not a separate, possibly-weaker
//    check. A non-member gets 403 and no task is created.
//  - Task creation goes through lib/actions/tasks.ts's createTaskForUser(),
//    the exact same validation/defaults/membership-check code path
//    createTask() (the web app's Server Action) uses — see that file for
//    why this was factored out rather than duplicated.

const METHODS = "POST, OPTIONS";

export const OPTIONS = extensionOptions(METHODS);

export const POST = withExtensionAuth(
  {
    methods: METHODS,
    rateLimit: { bucket: "tasks_post", limit: 60, windowSeconds: 3600 },
  },
  async (
    request: NextRequest,
    { user, headers, admin }: ExtensionAuthContext,
  ) => {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400, headers },
      );
    }

    const parsed = extensionCreateTaskSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
        { status: 400, headers },
      );
    }

    // AS-562: re-verify membership BEFORE attempting to create anything,
    // using the same requireActiveMembership() helper the web app's own
    // create-task path uses — not a separate check. createTaskForUser() also
    // re-checks this itself (defense in depth, same as the web app's
    // Server Action), but checking here first lets this route return a
    // precise 403 rather than createTaskForUser()'s generic
    // "{ ok: false, error }" shape, which carries no HTTP status of its own.
    const { data: projectRow, error: projectError } = await admin
      .from("projects")
      .select("id, workspace_id, deleted_at, key")
      .eq("id", parsed.data.projectId)
      .is("deleted_at", null)
      .maybeSingle();

    if (projectError || !projectRow) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404, headers },
      );
    }

    const membership = await requireActiveMembership(
      admin,
      projectRow.workspace_id,
      user.id,
    );

    if (!membership.ok) {
      return NextResponse.json(
        { error: "You don't have permission to create a task in this project." },
        { status: 403, headers },
      );
    }

    // F293 (AS-555, AS-556): the report form's remaining fields —
    // status/priority/assigneeId/dueDate — pass straight through to
    // createTaskForUser, which re-validates and re-checks assignee
    // membership itself (see lib/actions/tasks.ts) exactly as it already does
    // for the web app's own create-task Server Action. No new logic needed
    // here; extensionCreateTaskSchema (lib/validation/extension.ts) is what
    // changed to accept these fields.
    const result = await createTaskForUser(user.id, {
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      assigneeId: parsed.data.assigneeId,
      dueDate: parsed.data.dueDate,
      taskTypeId: parsed.data.taskTypeId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400, headers });
    }

    // F296 (AS-563): the success view needs a real, human-readable task key
    // and a link to open — computed here, server-side, via
    // lib/tasks/task-key.ts's formatTaskKey(), the ONE place in the codebase
    // that combines a project key + task number, so the extension never
    // independently reimplements that format. F246 (a deep-linked
    // per-task route) has not landed as of this feature, so the link is the
    // project's board URL instead, per this feature's own explicit
    // documented fallback — `boardPath` is a relative path (not an absolute
    // URL); the popup already knows its own APP_URL (extension/src/lib/
    // supabase.ts) and prefixes it, the same way every other extension->app
    // link in this codebase is built (see Popup.tsx's openConnectFlow).
    const taskKey = formatTaskKey(projectRow.key, result.data.number);

    const { data: workspaceRow } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", projectRow.workspace_id)
      .maybeSingle();

    const boardPath = workspaceRow?.slug
      ? `/w/${workspaceRow.slug}/projects/${projectRow.id}/board`
      : null;

    return NextResponse.json(
      { task: result.data, taskKey, boardPath },
      { status: 201, headers },
    );
  },
);
