import { notFound, redirect } from "next/navigation";

import { canViewClientPortal } from "@/lib/auth/permissions";
import { getWorkspaceRoleForCurrentUser } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";

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

  return <div className="min-h-svh bg-background">{children}</div>;
}
