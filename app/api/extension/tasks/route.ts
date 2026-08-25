import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
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
//  - Identity (AS-561): resolved ONLY from the `Authorization: Bearer
//    <access_token>` header's Supabase JWT, via `auth.getUser(token)`
//    against a fresh anon-key client (this validates the JWT's signature
//    and expiry against Supabase Auth itself — see "Decisions made" in the
//    handoff for why an anon-key client rather than the cookie-based
//    lib/supabase/server.ts createClient(), which reads *cookies*, not a
//    bearer header, and would not see this token at all). Any
//    identity-shaped field in the request body (there isn't one — see
//    lib/validation/extension.ts's extensionCreateTaskSchema) is never
//    read for this purpose.
//  - Membership (AS-562): re-verified server-side via the SAME
//    requireActiveMembership() helper lib/actions/tasks.ts's own
//    createTask() Server Action uses — not a separate, possibly-weaker
//    check. A non-member gets 403 and no task is created.
//  - Token validity (AS-572): no Authorization header, a malformed/garbage
//    token, and an expired or wrong-project token are all rejected with
//    401 — auth.getUser(token) returns an error for all of these cases
//    uniformly (Supabase does not distinguish "expired" from "invalid
//    signature" in this call's response), so this route responds 401 with
//    a single generic message for all of them rather than fabricating a
//    distinction Supabase itself doesn't expose.
//  - Task creation goes through lib/actions/tasks.ts's createTaskForUser(),
//    the exact same validation/defaults/membership-check code path
//    createTask() (the web app's Server Action) uses — see that file for
//    why this was factored out rather than duplicated.
//  - CORS: restricted to exactly one Origin, the extension's own
//    `chrome-extension://<id>`, read from the required `EXTENSION_ID` env
//    var (see .env.example — new for this feature, no prior convention
//    existed in this repo; see the handoff for the dev-vs-published-id
//    caveat).
//  - Rate limiting: explicitly cut from this mission's scope (per the
//    feature spec's "Notes for clarification") — this endpoint has no
//    request-rate protection. Stated here and in the handoff rather than
//    silently built or silently omitted.

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = process.env.EXTENSION_ID
    ? `chrome-extension://${process.env.EXTENSION_ID}`
    : null;

  if (!allowedOrigin || origin !== allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  // A same-origin dev/test request (no Origin header, e.g. this feature's
  // own vitest integration tests calling the exported POST() function
  // directly) is allowed through with no CORS headers attached — CORS is a
  // browser-enforced restriction on cross-origin *browser* requests, not an
  // authentication mechanism; the Authorization/membership checks below are
  // the actual security boundary. A real cross-origin browser request from
  // any Origin other than the configured extension id gets no
  // Access-Control-Allow-Origin header and the browser blocks it from
  // reading the response, per standard CORS behaviour.

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = bearerMatch?.[1]?.trim();

  if (!token) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header." },
      { status: 401, headers },
    );
  }

  // AS-561/AS-572: resolve the caller from the JWT itself, against
  // Supabase Auth — never from anything in the request body. A fresh
  // anon-key (publishable-key) client is used here rather than the
  // cookie-based lib/supabase/server.ts createClient(), because this
  // request carries a bearer token, not cookies; passing the token
  // directly to auth.getUser(token) is the documented way to validate an
  // out-of-band access token server-side (verified against the current
  // @supabase/supabase-js/auth-js API surface — auth.getUser(jwt) accepts
  // an explicit token and validates it against Supabase Auth without
  // requiring a full client session).
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
    // AS-572: missing, malformed, expired, and mismatched-project tokens
    // all land here — auth.getUser() returns an error (no distinguishable
    // "expired" vs "invalid signature" reason) for all of them.
    return NextResponse.json(
      { error: "Invalid or expired session. Reconnect the extension." },
      { status: 401, headers },
    );
  }

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
  const admin = createAdminClient();
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
}
