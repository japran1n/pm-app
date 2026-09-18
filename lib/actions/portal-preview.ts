"use server";

// F024 (missions/20260903-portal, AS-052, AS-053): "view the portal as a
// specific client" -- through the client's own permissions, not a
// `previewAsClientId` filter (see this feature's spec, section 2, for why
// that's explicitly prohibited).
//
// The mechanism: `mintImpersonationSession` (lib/auth/mint-impersonation-
// session.ts) mints a REAL Supabase session for the chosen client's own
// account. This action stores that session's access/refresh tokens in
// cookies scoped to `path: "/portal"` -- the browser only ever sends
// those cookies on a request to `/portal/*`, so `lib/supabase/server.ts`'s
// `createClient()` can pick them up and hand every portal Server
// Component the client's own session, with zero path-awareness required
// there. The previewer's own team session (`sb-*`, path `/`) is untouched
// -- unaffected on every `/w/*` route, because the preview cookies are
// simply never sent there.
//
// Nothing in the portal's own query/page code changes for this feature:
// the ENTIRE portal route tree renders unmodified, driven by the same RLS
// policies (tasks_select_client, 20260902010000/20260902020000, and every
// client-role policy since) that produce the real client's own page. That
// is what "produced through the client's own permissions rather than by
// bypassing them" (AS-052) means in code -- there is no second visibility
// rule anywhere in this file.
import { z } from "zod";
import { cookies } from "next/headers";

import { createRealSessionClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspaceAdmin } from "@/lib/auth/require-membership";
import { mintImpersonationSession } from "@/lib/auth/mint-impersonation-session";
import { logger } from "@/lib/observability/logger";
import type { Json } from "@/lib/supabase/database.types";
import {
  PORTAL_PREVIEW_ACCESS_COOKIE,
  PORTAL_PREVIEW_REFRESH_COOKIE,
  PORTAL_PREVIEW_LABEL_COOKIE,
  PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE,
} from "@/lib/portal/preview-cookies";
import type { ActionOutcome } from "@/lib/actions/authz";

// F024b (AS-053, "the cookies carry no maxAge"): 30 minutes -- enough to
// actually look at what the client sees, short enough that an admin who
// forgets to exit preview doesn't hold a live client session indefinitely.
// The only way to extend it is `exitClientPreview` + starting a fresh
// preview (which writes a new `portal.preview_started` audit row), per
// this feature's own spec section 3 ("re-entry writes a new audit row").
const PREVIEW_SESSION_MAX_AGE_SECONDS = 30 * 60;

// Cookies scoped to `/portal` only -- see file header. Not `secure: true`
// unconditionally because local/dev often runs over plain http; production
// still gets `secure` from NODE_ENV, same convention as every other
// session cookie this app sets.
function previewCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/portal",
    maxAge: PREVIEW_SESSION_MAX_AGE_SECONDS,
  };
}

const startSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceSlug: z.string().min(1),
  clientUserId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
});

export type StartClientPreviewResult = ActionOutcome<{ redirectTo: string }>;

// Returns a redirect target rather than calling `redirect()` itself --
// the caller (a Client Component form) navigates client-side after a
// successful result, the same "action returns ok/data, caller navigates"
// convention this codebase's other Server Actions already follow (e.g.
// lib/actions/portal-approval.ts).
export async function startClientPreview(
  rawInput: unknown,
): Promise<StartClientPreviewResult> {
  const parsed = startSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { workspaceId, workspaceSlug, clientUserId, projectId, taskId } =
    parsed.data;

  // F024b: explicitly the previewer's own real session -- this action is
  // only ever invoked from a `/w/*` page (no preview cookies present yet
  // at the point a preview is being STARTED), but `createRealSessionClient`
  // is used here regardless of that, so this stays correct even if that
  // assumption ever stops holding.
  const supabase = await createRealSessionClient();
  const {
    data: { user },
    // ARCH-002: sanctioned direct call — this action must resolve the
    // previewer's REAL session via `createRealSessionClient`, never the
    // shared request-cached client that `getCurrentUser()` wraps (which
    // could be preview-cookie-scoped).
    // eslint-disable-next-line no-restricted-syntax
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createAdminClient();

  // Owner/admin only (this feature's spec, section 3), checked through
  // the same require-membership seam every other authz-sensitive action
  // in this codebase uses.
  const membership = await requireWorkspaceAdmin(admin, workspaceId, user.id);
  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to preview the portal as a client.",
    };
  }

  const { data: clientMember, error: clientMemberError } = await admin
    .from("workspace_members")
    .select("id, role, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", clientUserId)
    .eq("status", "active")
    .maybeSingle();

  if (clientMemberError || !clientMember || clientMember.role !== "client") {
    return {
      ok: false,
      error: "That person is not an active client of this workspace.",
    };
  }

  const { data: clientUserRow, error: clientUserError } =
    await admin.auth.admin.getUserById(clientUserId);
  const clientEmail = clientUserRow?.user?.email ?? null;

  if (clientUserError || !clientEmail) {
    return { ok: false, error: "Could not resolve the client's account." };
  }

  // F024b (AS-053, "fail closed"): written from the previewer's OWN real
  // session (never the impersonated one -- write_audit_log_entry pins
  // actor_id to auth.uid(), and the client's session has no membership
  // row on this table's RPC-side check for a client role to write audit
  // entries through anyway). Written before the session mint below so an
  // entry exists for every attempt that got this far, even if minting
  // fails. Unlike every other caller of `writeAudit()` (which is
  // deliberately non-fatal, see that file's own header), a failed write
  // HERE is fatal and aborts the mint: AS-053 is a security assertion --
  // "every entry into the client-preview view is written to the audit
  // log" -- not a nicety, so a preview session must never exist without
  // the row that records who started it and why. This is why the RPC is
  // called directly rather than through the shared `writeAudit()` helper.
  const { error: auditError } = await supabase.rpc("write_audit_log_entry", {
    p_workspace_id: workspaceId,
    p_action: "portal.preview_started",
    p_target_type: "workspace_member",
    p_target_id: clientMember.id,
    p_metadata: {
      clientUserId,
      clientEmail,
      projectId: projectId ?? null,
      taskId: taskId ?? null,
    } as Json,
  });

  if (auditError) {
    logger.error("startClientPreview: audit write failed, refusing to start preview", {
      error: auditError,
    });
    return {
      ok: false,
      error: "Could not start the client preview session.",
    };
  }

  const session = await mintImpersonationSession(clientEmail);
  if (!session) {
    return {
      ok: false,
      error: "Could not start the client preview session.",
    };
  }

  const cookieStore = await cookies();
  const options = previewCookieOptions();
  cookieStore.set(PORTAL_PREVIEW_ACCESS_COOKIE, session.accessToken, options);
  cookieStore.set(
    PORTAL_PREVIEW_REFRESH_COOKIE,
    session.refreshToken,
    options,
  );
  cookieStore.set(PORTAL_PREVIEW_LABEL_COOKIE, clientEmail, options);
  cookieStore.set(PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE, clientMember.id, options);

  const redirectTo =
    taskId && projectId
      ? `/portal/${workspaceSlug}/p/${projectId}/t/${taskId}`
      : projectId
        ? `/portal/${workspaceSlug}/p/${projectId}`
        : `/portal/${workspaceSlug}`;

  return { ok: true, redirectTo };
}

export type ExitClientPreviewResult = { ok: true; redirectTo: string };

// Clears the preview cookies (path: "/portal", so this has no effect on
// the previewer's own team session cookies) and hands back a redirect
// target for the caller to navigate to. No auth re-check needed here --
// clearing three cookies scoped to a path only the portal ever sees is
// not a privileged operation, and a signed-out/expired caller simply gets
// cookies that were already invalid cleared again.
export async function exitClientPreview(
  workspaceSlug: string,
): Promise<ExitClientPreviewResult> {
  const cookieStore = await cookies();

  // P2-8: the cookies below are how *this* app stops treating the
  // request as a preview session, but the underlying Supabase session for
  // the impersonated client (minted by `mintImpersonationSession`) stays
  // valid server-side until it naturally expires otherwise -- its access
  // token could still be replayed directly against Supabase after
  // "exiting" preview. Read the preview access token straight off the
  // request cookie (NOT via `createClient()`/`createRealSessionClient()`
  // -- see lib/supabase/server.ts: the former would hand back the SAME
  // impersonated session wrapped read-only, fine but indirect, while the
  // latter deliberately ignores preview cookies and resolves to the
  // PREVIEWER'S OWN session, which must never be the one revoked here)
  // before the cookies are cleared, then revoke it server-side through
  // the admin API. Best-effort: a failure here just means the token
  // expires naturally at PREVIEW_SESSION_MAX_AGE_SECONDS like before this
  // fix -- it must never block clearing the cookies and returning the
  // previewer to their own admin surface.
  try {
    const previewAccessToken = cookieStore.get(
      PORTAL_PREVIEW_ACCESS_COOKIE,
    )?.value;
    if (previewAccessToken) {
      const admin = createAdminClient();
      await admin.auth.admin.signOut(previewAccessToken, "local");
    }
  } catch (error) {
    logger.error("exitClientPreview: session revocation failed", { error });
  }

  const expired = { path: "/portal" as const, maxAge: 0 };
  cookieStore.set(PORTAL_PREVIEW_ACCESS_COOKIE, "", expired);
  cookieStore.set(PORTAL_PREVIEW_REFRESH_COOKIE, "", expired);
  cookieStore.set(PORTAL_PREVIEW_LABEL_COOKIE, "", expired);
  cookieStore.set(PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE, "", expired);

  return { ok: true, redirectTo: `/w/${workspaceSlug}/preview-as-client` };
}
