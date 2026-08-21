import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/nav/app-sidebar";

// AS-022: force every request under /w/* through a real server round-trip
// instead of allowing the browser to serve a bfcache-restored copy of a
// previously-authenticated page after sign-out. Without this, hitting the
// back button after signOut() can repaint the last-rendered workspace DOM
// straight from bfcache with zero network request — proxy.ts's
// requiresAuth guard (F010, AS-001) never runs in that path because it
// only intercepts requests that actually hit the server. Marking this
// route segment force-dynamic disables static/full route caching and,
// combined with Next's cache-control behavior for dynamic routes,
// prevents the browser from treating this page as safe to restore from
// bfcache, so back-navigation after sign-out always re-invokes this
// layout's own `!user` -> redirect("/sign-in") check below.
export const dynamic = "force-dynamic";

// Server Component layout (AS-012, AS-013, AS-042, AS-144): resolves the
// active workspace from the URL slug, verifies the caller has an active
// membership, and fetches every active-membership workspace for the
// switcher. Next.js 16: `params` is a Promise and must be awaited.
//
// AS-144: a nonexistent workspace slug and an existing-but-not-a-member
// slug MUST be indistinguishable from the outside — otherwise a
// permission-denied response would itself leak that the workspace exists.
// RLS's `workspaces_select_active_members` policy already collapses both
// cases (plus soft-deleted) to "no row returned" from the query below, so
// both paths call the same `notFound()` — Next's generic 404 — rather than
// a redirect to a "you don't have access" page or `/onboarding`, either of
// which would confirm existence to a non-member.
export default async function WorkspaceLayout({
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

  // RLS (`workspaces_select_active_members`) already scopes this to
  // non-deleted workspaces the caller is an active member of, so a null
  // result here covers "doesn't exist", "soft-deleted", and "not an active
  // member" alike.
  const { data: activeWorkspace, error: activeWorkspaceError } =
    await supabase
      .from("workspaces")
      .select("id, name, slug")
      .eq("slug", workspaceSlug)
      .maybeSingle();

  if (activeWorkspaceError) {
    console.error(
      "WorkspaceLayout: failed to look up workspace by slug:",
      activeWorkspaceError,
    );
  }

  if (!activeWorkspace) {
    // AS-144: generic 404, not a redirect to /onboarding or any page that
    // would signal "you don't have access" — see file-header comment.
    notFound();
  }

  // All of the caller's active memberships, for the switcher list
  // (AS-012). Two-step query rather than an embedded select: the
  // generated `workspace_members` -> `workspaces` FK is not one-to-one, so
  // an embedded select types as an array and cannot be `.slug`-accessed
  // directly (same tradeoff F013's auth callback route made).
  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (membershipsError) {
    console.error(
      "WorkspaceLayout: failed to look up user's memberships:",
      membershipsError,
    );
  }

  // F273 (AS-202): the signed-in person's own display name/avatar for the
  // sidebar footer entry point that links to the profile settings page —
  // without this the profile page (F123) has no in-app way to reach it.
  // Same fallback order as UserAvatar's `personLabel`/`initialsFor`
  // helpers (display name, then email, then id), kept here rather than
  // imported so the layout doesn't need a client-only import just for a
  // label string.
  const { data: currentUserProfile, error: currentUserProfileError } =
    await supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

  if (currentUserProfileError) {
    console.error(
      "WorkspaceLayout: failed to look up current user's profile:",
      currentUserProfileError,
    );
  }

  const workspaceIds = (memberships ?? []).map((m) => m.workspace_id);

  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, slug")
        .in("id", workspaceIds)
        .order("name", { ascending: true })
    : { data: [], error: null };

  if (workspacesError) {
    console.error(
      "WorkspaceLayout: failed to look up member workspaces:",
      workspacesError,
    );
  }

  // The active workspace is guaranteed to be an active membership (we just
  // verified that above), so it must appear in `workspaces` unless the two
  // queries raced with a concurrent membership change; fall back to
  // including it explicitly so the switcher never omits the current
  // workspace (AS-012/AS-013).
  const switcherWorkspaces = (workspaces ?? []).some(
    (w) => w.id === activeWorkspace.id,
  )
    ? (workspaces ?? [])
    : [...(workspaces ?? []), activeWorkspace];

  // Persistent nav shell: AppSidebar renders both the always-on desktop
  // sidebar (workspace switcher, primary nav, sign-out) and, on narrow
  // viewports, a slim hamburger bar that opens the same content in a
  // sheet. No separate topbar component: with the sidebar already showing
  // which section is active, a second row of nav chrome across the main
  // content area would be redundant — each page is expected to render its
  // own heading (e.g. "Projects", "Members") as the page-title convention
  // instead.
  return (
    <div className="flex min-h-svh">
      <AppSidebar
        workspaceSlug={workspaceSlug}
        workspaces={switcherWorkspaces}
        currentWorkspaceId={activeWorkspace.id}
        currentUser={{
          id: user.id,
          name: currentUserProfile?.display_name ?? null,
          email: user.email ?? null,
          avatarUrl: currentUserProfile?.avatar_url ?? null,
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
