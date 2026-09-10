import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { canViewClientPortal } from "@/lib/auth/permissions";
import { getWorkspaceRoleForCurrentUser } from "@/lib/queries/portal";
import { createClient, createRealSessionClient } from "@/lib/supabase/server";
import {
  PORTAL_PREVIEW_ACCESS_COOKIE,
  PORTAL_PREVIEW_LABEL_COOKIE,
  PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE,
} from "@/lib/portal/preview-cookies";
import { ClientPreviewBanner } from "@/components/portal/client-preview-banner";
import { writeAudit } from "@/lib/activity/audit";

// C3 (docs/client-portal-plan.md): the client portal's own shell.
//
// URL shape: `/portal/<workspaceSlug>`, NOT `/w/<slug>/portal` as the plan
// originally sketched. Two route groups cannot both own the `w/[slug]`
// segment, and a top-level path turns out to be the better answer anyway —
// there is no URL under which a client is inside the team app's routing at
// all, so no future page added under `/w/*` can accidentally inherit a
// client session.
//
// This layout is chrome, not a security boundary. RLS is
// (20260902010000 / 20260902020000): a client who edits the URL, replays a
// request, or calls PostgREST directly still sees only shared tasks. What
// this adds is that the two audiences never see each other's UI — a client
// is redirected here from the app, and a team member is redirected out of
// here into the app, so the portal never becomes a second, weaker view of
// the same data for staff.
//
// F003 (missions/20260903-portal): this used to also render the portal's
// visible chrome (brand header, `PortalNav`, theme toggle, sign-out) for
// every route under `/portal/<slug>`. That header is gone -- the
// prototype's shell is project-scoped (a sidebar naming the CURRENT
// project, per AS-001/AS-005), and this layout has no `projectId` to
// scope it with: only a route nested under `p/[projectId]/...` does. The
// real shell now lives in
// `app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx`; this
// layout goes back to being exactly what its own comment above always
// said it was -- a guard, not chrome. `[workspaceSlug]/page.tsx` (the
// project chooser, shown when a client has zero or several portal-enabled
// projects) renders its own minimal header for the same reason.
//
// Every guard below is unchanged from before this feature: unauthenticated
// -> /sign-in, unknown workspace -> notFound, non-client role -> redirect
// to /w/<slug>. None of it was touched.
export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Same reasoning as the workspace layout's own lookup: RLS collapses
  // "doesn't exist", "soft-deleted" and "not a member" into one empty
  // result, so all three end at the same generic 404 and none of them
  // confirms the workspace exists.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug, logo_url")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    notFound();
  }

  const role = await getWorkspaceRoleForCurrentUser(workspace.id, user.id);

  if (!role) {
    notFound();
  }

  // A team member who lands here is sent to the app they actually belong
  // in, rather than being shown a stripped-down view of their own data.
  if (!canViewClientPortal({ role: role as never })) {
    redirect(`/w/${workspace.slug}`);
  }

  // F024 (AS-052): `lib/supabase/server.ts`'s createClient() above has
  // already picked up the impersonated client's session transparently if
  // the preview cookies were present (they're scoped `path: "/portal"`,
  // so the browser only ever sends them here) -- the guard checks above
  // this point already ran AS the client, which is exactly the point.
  // This block only decides whether to render the non-dismissable banner
  // (spec section 3); it reads the raw cookie directly rather than
  // threading a flag through createClient()'s return value, since that
  // function's signature is shared by every other caller in the app.
  const cookieStore = await cookies();
  const isPreview = Boolean(
    cookieStore.get(PORTAL_PREVIEW_ACCESS_COOKIE)?.value,
  );
  const previewLabel = cookieStore.get(PORTAL_PREVIEW_LABEL_COOKIE)?.value;

  // F024b (AS-053, "every entry into the client-preview view is written
  // to the audit log"): `startClientPreview` only wrote one row when the
  // preview session was minted -- since the cookies persist for the rest
  // of the (now TTL-bounded, see portal-preview.ts) browser session, an
  // admin who leaves and returns to `/portal/*` any number of times wrote
  // no further rows. This records each subsequent entry too, distinctly
  // named (`portal.preview_entered`) from the start event. Written
  // through `createRealSessionClient()` -- NOT the `supabase` client
  // above, which under preview is the impersonated client and would pin
  // `write_audit_log_entry`'s `auth.uid()` actor to the CLIENT, defeating
  // the entire point of an audit trail meant to record the previewer.
  // Best-effort (the existing, non-fatal `writeAudit()` convention):
  // unlike the fail-closed start-of-preview write in
  // `startClientPreview`, refusing to RENDER the page because a re-entry
  // audit row failed to write would be a worse outcome than logging the
  // gap and letting an already-live, already-audited preview session
  // continue.
  if (isPreview) {
    const clientMemberId = cookieStore.get(
      PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE,
    )?.value;
    if (clientMemberId) {
      const realSupabase = await createRealSessionClient();
      await writeAudit(realSupabase, {
        workspaceId: workspace.id,
        action: "portal.preview_entered",
        targetType: "workspace_member",
        targetId: clientMemberId,
        metadata: { path: `/portal/${workspaceSlug}` },
      });
    }
  }

  return (
    <div className="min-h-svh bg-background">
      {isPreview && previewLabel && (
        <ClientPreviewBanner
          workspaceSlug={workspace.slug}
          clientLabel={previewLabel}
        />
      )}
      {children}
    </div>
  );
}
