import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// F334 (M17 scrutiny BLOCKER-3): import the plain, non-"use server" upload
// implementation directly, NOT through lib/actions/attachments.ts. That
// file's only exported upload surface is now the FormData-taking
// `uploadAttachment` Server Action, which resolves identity from the
// caller's own cookie session — inapplicable here, since this Route
// Handler authenticates via a bearer JWT instead. Importing from
// lib/attachments/upload.ts keeps this route's already-verified `user.id`
// (see below) flowing straight into the shared logic without going through
// a client-invocable Server Action endpoint.
import { uploadAttachmentForUser } from "@/lib/attachments/upload";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/validation/attachments";

// F294 (AS-559, AS-566, AS-567): the third narrow authenticated Route
// Handler the QA feedback browser extension calls — this one attaches the
// reporter's annotated screenshot (if they captured one) to a task that was
// already created via F292's app/api/extension/tasks/route.ts.
//
// Order of operations (documented in full in the F294 handoff's "Decisions
// made"): the task must already exist before this route can be called at
// all, because the existing `task-attachments` bucket's own INSERT RLS
// policy (supabase/migrations/20260818050100_create_attachments.sql)
// authorizes an upload by parsing the *first path segment* of the object
// name as a live task id — there is no attachments row yet at upload time
// for a SELECT-style join to authorize against instead. Reusing the
// existing bucket/RLS (per this feature's explicit instruction not to
// invent a new storage path) therefore forces "task exists first, then
// upload" as the only compliant ordering, not a free choice between
// "upload first" and "create then upload".
//
// This is not a half-state risk the way the spec's framing worries about:
// `tasks` has no attachment-reference column of its own (attachments are a
// separate child table joined by `task_id`), so a task that exists with no
// attachment row is simply "a task with no attachments" — a normal, valid
// state, never a "broken image reference" on the task itself (AS-567). The
// only place a real half-state could occur is inside the attachment
// upload+insert pair itself (Storage object with no row, or vice versa),
// which is exactly what uploadAttachmentForUser's storage-first-then-insert
// (with cleanup-on-insert-failure) ordering already guards against — reused
// verbatim from F065's lib/actions/attachments.ts, not reimplemented here.
//
// Size check (AS-566): validated here via uploadAttachmentSchema (which
// uses MAX_ATTACHMENT_SIZE_BYTES) as defense in depth — the extension's own
// UI (extension/src/submit/upload.ts) checks size BEFORE even attempting to
// create the task, so a real oversized-capture attempt never reaches this
// route at all in the normal flow. This server-side check exists for the
// same reason every other boundary in this mission has one: a buggy or
// bypassed client must not be able to smuggle an oversized file through.
//
// Auth: identical bearer-JWT pattern to F292/F293's routes (duplicated, not
// shared — same rationale documented in F293's context route).
// CORS: identical EXTENSION_ID-scoped allowlist as F292/F293's routes.

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request body must be multipart form data." },
      { status: 400, headers },
    );
  }

  const taskId = formData.get("taskId");
  const file = formData.get("file");

  if (typeof taskId !== "string" || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Invalid upload request." },
      { status: 400, headers },
    );
  }

  // AS-566: reject an oversized file with a message naming the actual
  // limit, before ever calling Storage — same early-return convention
  // uploadAttachmentForUser's Zod schema already enforces (this explicit
  // check here just gives a clearer, faster-failing message at the route
  // boundary; uploadAttachmentForUser re-validates the same limit itself).
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `File must be ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
      },
      { status: 400, headers },
    );
  }

  const arrayBuffer = await file.arrayBuffer();

  const result = await uploadAttachmentForUser(user.id, {
    taskId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    arrayBuffer,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400, headers });
  }

  return NextResponse.json(
    { attachment: result.data },
    { status: 201, headers },
  );
}
