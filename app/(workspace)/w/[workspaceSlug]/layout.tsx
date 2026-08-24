import { notFound, redirect, permanentRedirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/nav/app-sidebar";
// F135 (AS-231): the membership context provider — see that file's own doc
// comment for why this exists alongside (not instead of) the more precise
// per-fetch role props (e.g. TaskDetailSheet's own currentUserRole) other
// features already thread through explicitly.
import { MembershipProvider } from "@/components/auth/membership-provider";
import { canManageProject, type ProjectRole } from "@/lib/auth/permissions";
// F208 (AS-379): the sidebar's notification bell needs its initial
// unread-count + list server-fetched here, same "server-fetched in the
// layout, passed down as props" convention every other sidebar-fed value
// on this page already follows (currentUser, workspaces, isGuest).
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
// F241 (AS-459, AS-463, AS-464): mounted once here, alongside the other
// persistent workspace chrome, so a single global Cmd+K/Ctrl+K listener
// owns the shortcut rather than one instance fighting another per page.
import { CommandPalette } from "@/components/command/command-palette";
// F244 (AS-467, AS-468, AS-470, AS-471): the global single-key shortcut
// listener (n, /, Escape) — mounted alongside CommandPalette, see that
// component's own file-header comment for why these stay as two separate
// `document` keydown listeners rather than one merged listener.
import { ShortcutProvider } from "@/components/command/shortcut-provider";
// F245 (AS-469, AS-472): `?` opens this reference dialog, rendered from
// the SAME registry ShortcutProvider dispatches from.
import { ShortcutHelpDialog } from "@/components/command/shortcut-help";
// F253 (AS-491, AS-492, AS-493): the first-run guided tour, mounted once
// alongside the other persistent workspace chrome. `initialDismissed` is
// server-fetched here (same "server-fetched... passed down as typed
// props" pattern as everything else on this layout) so a returning user
// never sees a flash of the tour before a client-side check catches up.
import { OnboardingTour } from "@/components/onboarding/tour";
import { getTourStatus } from "@/lib/actions/onboarding-tour";

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
      .select("id, name, slug, logo_url")
      .eq("slug", workspaceSlug)
      .maybeSingle();

  if (activeWorkspaceError) {
    console.error(
      "WorkspaceLayout: failed to look up workspace by slug:",
      activeWorkspaceError,
    );
  }

  if (!activeWorkspace) {
    // F137 (AS-241): before giving up with a generic 404, check whether
    // this slug is a RETIRED one (the workspace changed its slug via
    // `changeWorkspaceSlug`, lib/actions/workspaces.ts) rather than one
    // that never existed. If so, permanently redirect to the same path
    // under the workspace's current slug instead of 404ing — a bookmark
    // or shared link built from the old slug keeps working.
    //
    // This lookup deliberately runs with no membership check of its own:
    // `workspace_slug_history` only reveals "this old slug now maps to
    // workspace id X" (see that table's own RLS policy comment — no
    // information beyond what a slug itself already carries), and the
    // redirect target still passes back through this exact guard on the
    // next request, re-running the real `workspaces_select_active_members`
    // membership check against the NEW slug. A non-member hitting an old
    // slug for a workspace they don't belong to still ends up at the same
    // generic 404 AS-144 requires — just one redirect further along —
    // rather than this shortcut ever granting access the membership check
    // would otherwise deny.
    const { data: slugHistoryRow, error: slugHistoryError } = await supabase
      .from("workspace_slug_history")
      .select("workspace_id")
      .eq("old_slug", workspaceSlug)
      .maybeSingle();

    if (slugHistoryError) {
      console.error(
        "WorkspaceLayout: failed to look up slug history:",
        slugHistoryError,
      );
    }

    if (slugHistoryRow) {
      const { data: currentWorkspace } = await supabase
        .from("workspaces")
        .select("slug")
        .eq("id", slugHistoryRow.workspace_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (currentWorkspace?.slug) {
        // Permanent redirect (AS-241): the old URL is gone for good, not
        // a temporary detour. `permanentRedirect()` (as opposed to plain
        // `redirect()`) is what Next.js maps to a 308 status in a Route
        // Handler, or a permanent-semantics client navigation elsewhere —
        // telling clients and intermediaries this is the canonical new
        // location, not a one-off reroute.
        permanentRedirect(`/w/${currentWorkspace.slug}`);
      }
    }

    // AS-144: generic 404, not a redirect to /onboarding or any page that
    // would signal "you don't have access" — see file-header comment.
    notFound();
  }

  // All of the caller's active memberships, for the switcher list
  // (AS-012). Two-step query rather than an embedded select: the
  // generated `workspace_members` -> `workspaces` FK is not one-to-one, so
  // an embedded select types as an array and cannot be `.slug`-accessed
  // directly (same tradeoff F013's auth callback route made).
  //
  // F134 (AS-222): `role` is fetched alongside so the sidebar can hide the
  // "Members" link for a guest — every page under this layout shares one
  // fetch of the caller's role in *this* workspace rather than each page
  // re-querying it.
  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
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

  // F208 (AS-379): initial notification bell state for THIS workspace,
  // fetched alongside everything else the sidebar needs. Non-fatal to the
  // rest of the layout if it fails — getNotificationsForWorkspace already
  // logs and falls back to an empty list/zero count internally.
  const { list: initialNotifications, unreadCount: initialUnreadCount } =
    await getNotificationsForWorkspace(activeWorkspace.id);

  // F253: non-fatal to the rest of the layout if this read fails --
  // failing open to "already dismissed" (never show an unexpected tour on
  // top of an otherwise-broken read) rather than failing closed and
  // forcing every page load into a tour for a user who already saw it.
  const tourStatusResult = await getTourStatus();
  const tourDismissed = tourStatusResult.ok ? tourStatusResult.dismissed : true;

  const workspaceIds = (memberships ?? []).map((m) => m.workspace_id);

  // F134 (AS-222): the caller's own role in the *active* workspace
  // specifically (not just "some role in some workspace" — a person can be
  // a guest in one workspace and an owner in another, per-workspace roles
  // being this codebase's existing model).
  const isGuest =
    (memberships ?? []).find((m) => m.workspace_id === activeWorkspace.id)
      ?.role === "guest";

  // F135 (AS-231): the caller's own workspace role, in full (not just the
  // isGuest boolean above) — the single value MembershipProvider exposes
  // to every client component under this layout so mutating controls can
  // gate themselves via lib/auth/permissions.ts without a per-component
  // re-fetch. Defaults to "guest" (the least-privileged role) in the
  // defensive case where the caller somehow has no matching membership row
  // despite the workspace lookup above having already succeeded (should be
  // unreachable — the workspace query itself is scoped to active
  // memberships — but a safe fallback here is strictly better than
  // crashing or silently granting a wider role than the caller has).
  const activeWorkspaceRole =
    (memberships ?? []).find((m) => m.workspace_id === activeWorkspace.id)
      ?.role ?? "guest";

  // F135 (AS-231): every project_members row the caller has for a project
  // IN THIS WORKSPACE — one query, loaded once per layout render, so every
  // client component under this layout (board rows, list rows, task
  // detail) can gate a project-lead-scoped control (e.g. canManageColumns,
  // canDeleteTask) without its own fetch. Scoped to the active workspace
  // via the `projects!inner(workspace_id)` embed — project_members' own
  // RLS policy (`project_members_select_active_members`) already limits
  // this to projects whose workspace the caller is an active member of,
  // but without this filter a caller who belongs to project_members rows
  // in more than one workspace would get another workspace's project ids
  // mixed into this one's map.
  const { data: projectMemberRows, error: projectMemberRowsError } =
    await supabase
      .from("project_members")
      .select("project_id, project_role, projects!inner(workspace_id)")
      .eq("user_id", user.id)
      .eq("projects.workspace_id", activeWorkspace.id);

  if (projectMemberRowsError) {
    console.error(
      "WorkspaceLayout: failed to look up caller's project memberships:",
      projectMemberRowsError,
    );
  }

  const projectRoles: Record<string, ProjectRole> = {};
  for (const row of projectMemberRows ?? []) {
    projectRoles[row.project_id] = row.project_role as ProjectRole;
  }

  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, slug, logo_url")
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
  const workspacesWithFallback = (workspaces ?? []).some(
    (w) => w.id === activeWorkspace.id,
  )
    ? (workspaces ?? [])
    : [...(workspaces ?? []), activeWorkspace];

  // F138 (AS-243): camelCase `logoUrl` for SwitcherWorkspace/AppSidebar's
  // props, mapped once here rather than threading the raw snake_case
  // column name through the client component boundary.
  const switcherWorkspaces = workspacesWithFallback.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    logoUrl: w.logo_url ?? null,
  }));

  // Persistent nav shell: AppSidebar renders both the always-on desktop
  // sidebar (workspace switcher, primary nav, sign-out) and, on narrow
  // viewports, a slim hamburger bar that opens the same content in a
  // sheet. No separate topbar component: with the sidebar already showing
  // which section is active, a second row of nav chrome across the main
  // content area would be redundant — each page is expected to render its
  // own heading (e.g. "Projects", "Members") as the page-title convention
  // instead.
  return (
    <MembershipProvider role={activeWorkspaceRole} projectRoles={projectRoles}>
      <CommandPalette
        workspaceId={activeWorkspace.id}
        workspaceSlug={workspaceSlug}
      />
      <ShortcutProvider />
      <ShortcutHelpDialog />
      <OnboardingTour initialDismissed={tourDismissed} />
      <div className="flex min-h-svh">
        <AppSidebar
          workspaceSlug={workspaceSlug}
          workspaces={switcherWorkspaces}
          currentWorkspaceId={activeWorkspace.id}
          isGuest={isGuest}
          // F136 (AS-239): gates the sidebar's "Settings" nav item to
          // owner/admin, the same `canManageProject` predicate the
          // settings page itself uses to decide what's rendered
          // interactive (AS-230 convention).
          canManageWorkspace={canManageProject({ role: activeWorkspaceRole })}
          currentUser={{
            id: user.id,
            name: currentUserProfile?.display_name ?? null,
            email: user.email ?? null,
            avatarUrl: currentUserProfile?.avatar_url ?? null,
          }}
          initialNotifications={initialNotifications}
          initialUnreadCount={initialUnreadCount}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </MembershipProvider>
  );
}
