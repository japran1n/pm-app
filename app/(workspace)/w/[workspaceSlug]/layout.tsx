import { Suspense } from "react";
import { notFound, redirect, permanentRedirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getWorkspaceBySlug } from "@/lib/queries/workspaces";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { logger } from "@/lib/observability/logger";
// F267 (AS-519, AS-520, AS-521, AS-522): the header search bar, rendered
// above every workspace page's own content, alongside the sidebar (see
// that component's own file-header comment for why the notification
// bell/user menu stay in the sidebar rather than moving here).
import { AppHeader } from "@/components/nav/app-header";
// F135 (AS-231): the membership context provider — see that file's own doc
// comment for why this exists alongside (not instead of) the more precise
// per-fetch role props (e.g. TaskDetailSheet's own currentUserRole) other
// features already thread through explicitly.
import { MembershipProvider } from "@/components/auth/membership-provider";
// F7 (docs/advanced-chat-plan.md): workspace-wide online presence, mounted
// once here alongside MembershipProvider -- see that provider's own file
// header for why tracking happens at this layout mount rather than per
// chat channel.
import { WorkspacePresenceProvider } from "@/components/nav/workspace-presence-provider";
import { canManageProject, type ProjectRole } from "@/lib/auth/permissions";
// F016 (AS-017): every sidebar figure below now resolves inside its own
// `<Suspense fallback={null}>`, wrapping a small async server component
// from `components/nav/figures/*` that fetches its own value -- none of
// them is awaited by this layout body anymore (see each figure's own
// file-header comment for what it replaces).
import { NotificationBellFigure } from "@/components/nav/figures/notification-bell-figure";
import { TourFigure } from "@/components/nav/figures/tour-figure";
import { ApprovalsBadgeFigure } from "@/components/nav/figures/approvals-badge-figure";
import { RequestsBadgeFigure } from "@/components/nav/figures/requests-badge-figure";
import { ChatUnreadBadgeFigure } from "@/components/nav/figures/chat-unread-badge-figure";
import { WorkspaceSwitcherFigure } from "@/components/nav/figures/workspace-switcher-figure";
import {
  NavBadgeSkeleton,
  NotificationBellSkeleton,
  WorkspaceSwitcherSkeleton,
} from "@/components/nav/figures/skeletons";
// F241 (AS-459, AS-463, AS-464): mounted once here, alongside the other
// persistent workspace chrome, so a single global Cmd+K/Ctrl+K listener
// owns the shortcut rather than one instance fighting another per page.
import { CommandPalette } from "@/components/command/command-palette";
// Follow-up (Cmd+P project switcher): mounted alongside CommandPalette —
// see that component's own file-header comment for why it owns a separate
// Cmd+P `document` keydown listener rather than being folded into
// CommandPalette's Cmd+K modal or ShortcutProvider's bare-single-key
// listener.
import { ProjectSwitcher } from "@/components/command/project-switcher";
// F244 (AS-467, AS-468, AS-470, AS-471): the global single-key shortcut
// listener (n, /, Escape) — mounted alongside CommandPalette, see that
// component's own file-header comment for why these stay as two separate
// `document` keydown listeners rather than one merged listener.
import { ShortcutProvider } from "@/components/command/shortcut-provider";
// F245 (AS-469, AS-472): `?` opens this reference dialog, rendered from
// the SAME registry ShortcutProvider dispatches from.
import { ShortcutHelpDialog } from "@/components/command/shortcut-help";
// Quick note (Alt/Option+Shift+N): global Personal to-dos capture.
import { QuickNoteModal } from "@/components/my-tasks/quick-note-modal";
// F253 (AS-491, AS-492, AS-493): the first-run guided tour, mounted once
// alongside the other persistent workspace chrome. `initialDismissed` is
// server-fetched here (same "server-fetched... passed down as typed
// props" pattern as everything else on this layout) so a returning user
// never sees a flash of the tour before a client-side check catches up.
// F262 (AS-509, AS-511, AS-512, AS-513): the sidebar's own "Projects"
// section reuses the exact same RLS-backed, guest-scoped query the
// /projects page (F027) already calls — no second copy of the visibility
// rule, and per this feature's clarified caching note, one fetch per
// layout render (not a per-navigation client refetch).
import { getWorkspaceProjects } from "@/lib/queries/projects";
// F016 (AS-017): favourites' own fetch, isolated into its own file — see
// that file's own header comment for why it stays awaited here (not
// deferred behind its own Suspense boundary) unlike every other figure
// above.
import { getFavoriteProjectIds } from "@/components/nav/figures/favorite-project-ids-figure";
import { BreadcrumbProvider } from "@/components/nav/breadcrumb-context";
// Client Presentation feature: computed fresh on every layout render
// (see lib/calendar/client-presentation.ts's own file-header comment for
// why this is a page-load-triggered check rather than a real scheduled
// job) so the banner below is visible on every page under this workspace,
// not just the calendar.
import { getUpcomingClientPresentations } from "@/lib/calendar/client-presentation";
import { ClientPresentationBanner } from "@/components/calendar/client-presentation-banner";
// Bugfix (whitespace-below-short-content): see this component's own
// file-header comment for why `<main>`'s sizing is decided per-route here
// instead of being a single fixed class on the element below.
import { WorkspaceMain } from "@/components/nav/workspace-main";

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

// F018 (AS-016, AS-018): the advance-notice banner's own data isn't needed to
// decide what this layout renders (unlike the membership check above it never
// gates access, and unlike the sidebar figures it isn't already covered by an
// F016 component) -- it only feeds a single, purely decorative slot inside
// `<WorkspaceMain>`. Isolating its fetch into its own async component lets the
// layout body return its shell without waiting on it, matching every other
// F016 sidebar figure's `<Suspense fallback={null}>` pattern instead of
// blocking on a third round trip alongside auth + workspace resolution.
async function ClientPresentationBannerFigure({
  supabase,
  workspaceId,
  workspaceSlug,
}: {
  supabase: Awaited<ReturnType<typeof getCurrentUser>>["supabase"];
  workspaceId: string;
  workspaceSlug: string;
}) {
  // Already fails open to [] internally -- see this function's own doc
  // comment in lib/calendar/client-presentation.ts.
  const upcomingClientPresentations = await getUpcomingClientPresentations(
    supabase,
    workspaceId,
  );

  return (
    <ClientPresentationBanner
      presentations={upcomingClientPresentations}
      workspaceSlug={workspaceSlug}
    />
  );
}

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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  // RLS (`workspaces_select_active_members`) already scopes this to
  // non-deleted workspaces the caller is an active member of, so a null
  // result here covers "doesn't exist", "soft-deleted", and "not an active
  // member" alike.
  const activeWorkspace = await getWorkspaceBySlug(workspaceSlug);

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
      logger.error("WorkspaceLayout: failed to look up slug history", { error: slugHistoryError });
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

  // All independent data fetches run in parallel — memberships, profile,
  // sidebar projects, favorites, client count, and project roles are all
  // independent of each other once user + activeWorkspace are known. This
  // collapses the serial round-trips into one parallel batch.
  //
  // F016 (AS-017): notifications, tour status, approvals/requests/chat
  // badge counts, and the workspace switcher list used to be awaited
  // here too. Each of those is now its own async server component under
  // `components/nav/figures/`, rendered below inside its own `<Suspense
  // fallback={null}>` — this layout body no longer awaits any of them, so
  // it can return its own JSX as soon as the awaits below (auth,
  // memberships, and the other values genuinely needed to decide what to
  // render) settle.
  //
  // F018 (AS-016, AS-018): the client-presentation banner's data moved out
  // of this batch the same way — see `ClientPresentationBannerFigure`
  // above, rendered below inside its own `<Suspense fallback={null}>`.
  // Everything still awaited below is either the membership check itself
  // (gates whether the page renders at all) or a value a slot renders
  // synchronously (sidebar projects/favorites/profile feed `<AppSidebar>`
  // and `<ProjectSwitcher>` props directly, not a Suspense-wrapped slot;
  // client count/project roles feed `<MembershipProvider>`, which wraps
  // every child on the page).
  const [
    { data: memberships, error: membershipsError },
    { data: currentUserProfile, error: currentUserProfileError },
    sidebarProjectsResult,
    favoriteProjectIds,
    { count: clientMemberCount },
    { data: projectMemberRows, error: projectMemberRowsError },
  ] = await Promise.all([
    // F134 (AS-222): caller's active memberships for workspace switcher +
    // role resolution. Two-step query (not embedded select) — see original
    // comment re: FK type constraints.
    supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("status", "active"),

    // F273 (AS-202): signed-in person's display name / avatar for sidebar footer.
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),

    // F262: sidebar projects. Fails open to empty list. Still awaited
    // here (not deferred) — `<ProjectSwitcher>` (the Cmd+P command
    // palette, mounted directly below) needs this same list synchronously
    // and isn't one of this feature's sidebar figures.
    getWorkspaceProjects(activeWorkspace.id).then(
      (projects) => ({ projects, error: null }),
      (error) => {
        logger.error("WorkspaceLayout: failed to look up workspace projects for sidebar", { error: error });
        return { projects: [] as Awaited<ReturnType<typeof getWorkspaceProjects>>, error };
      },
    ),

    // F263 (AS-510): favourite project ids. getFavoriteProjectIds already fails open.
    // F004 (AS-004): pass the already-resolved user id so this call skips
    // its own `auth.getUser()` round trip.
    // F016: see components/nav/figures/favorite-project-ids-figure.ts's own
    // header comment for why this one figure stays awaited here instead of
    // moving behind its own Suspense boundary.
    getFavoriteProjectIds(activeWorkspace.id, user.id),

    // C2: client member count for MembershipProvider's hasClient flag.
    supabase
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", activeWorkspace.id)
      .eq("role", "client")
      .eq("status", "active"),

    // F135 (AS-231): caller's project_member rows for this workspace,
    // scoped via projects!inner(workspace_id) to avoid cross-workspace mixing.
    supabase
      .from("project_members")
      .select("project_id, project_role, projects!inner(workspace_id)")
      .eq("user_id", user.id)
      .eq("projects.workspace_id", activeWorkspace.id),
  ]);

  if (membershipsError) {
    logger.error("WorkspaceLayout: failed to look up user's memberships", { error: membershipsError });
  }
  if (currentUserProfileError) {
    logger.error("WorkspaceLayout: failed to look up current user's profile", { error: currentUserProfileError });
  }
  if (projectMemberRowsError) {
    logger.error("WorkspaceLayout: failed to look up caller's project memberships", { error: projectMemberRowsError });
  }

  const sidebarProjects = sidebarProjectsResult.projects;

  // C3: a client belongs in the portal, not here. Checked after memberships
  // resolve (now part of the parallel batch above).
  const currentRole = (memberships ?? []).find(
    (m) => m.workspace_id === activeWorkspace.id,
  )?.role;

  if (currentRole === "client") {
    redirect(`/portal/${activeWorkspace.slug}`);
  }

  const workspaceIds = (memberships ?? []).map((m) => m.workspace_id);

  // F134 (AS-222): role in the active workspace specifically.
  const isGuest =
    (memberships ?? []).find((m) => m.workspace_id === activeWorkspace.id)
      ?.role === "guest";

  // F135 (AS-231): full workspace role for MembershipProvider.
  const activeWorkspaceRole =
    (memberships ?? []).find((m) => m.workspace_id === activeWorkspace.id)
      ?.role ?? "guest";

  const projectRoles: Record<string, ProjectRole> = {};
  for (const row of projectMemberRows ?? []) {
    projectRoles[row.project_id] = row.project_role as ProjectRole;
  }

  // F016 (AS-017): the workspace switcher's own list-lookup query used to
  // run here (needing `workspaceIds` from memberships above). It's now
  // `<WorkspaceSwitcherFigure>`, rendered below inside its own `<Suspense
  // fallback={null}>` — see that component's own file-header comment.

  // Persistent nav shell: AppSidebar renders both the always-on desktop
  // sidebar (workspace switcher, primary nav, sign-out) and, on narrow
  // viewports, a slim hamburger bar that opens the same content in a
  // sheet. No separate topbar component: with the sidebar already showing
  // which section is active, a second row of nav chrome across the main
  // content area would be redundant — each page is expected to render its
  // own heading (e.g. "Projects", "Members") as the page-title convention
  // instead.
  return (
    <MembershipProvider
      role={activeWorkspaceRole}
      hasClient={(clientMemberCount ?? 0) > 0}
      projectRoles={projectRoles}
    >
      <WorkspacePresenceProvider
        workspaceId={activeWorkspace.id}
        currentUserId={user.id}
      >
      <CommandPalette
        workspaceId={activeWorkspace.id}
        workspaceSlug={workspaceSlug}
      />
      <ProjectSwitcher
        workspaceSlug={workspaceSlug}
        projects={sidebarProjects.map((project) => ({
          id: project.id,
          name: project.name,
          key: project.key,
        }))}
      />
      <ShortcutProvider />
      <ShortcutHelpDialog />
      <QuickNoteModal workspaceId={activeWorkspace.id} />
      {/* F016 (AS-017): tour status is now its own async server component,
          streamed in independently rather than awaited by this layout
          body. */}
      <Suspense fallback={null}>
        <TourFigure />
      </Suspense>
      <BreadcrumbProvider>
      {
        // F120 (AS-073): `h-svh` (a fixed height, not a minimum) caps this
        // row at the viewport exactly. `<AppSidebar>`'s own root element
        // opts out of the row's default cross-axis stretch itself (it sets
        // `sticky top-0 h-svh self-start` directly -- see that component),
        // so it's always pinned to the viewport regardless of `<main>`'s
        // height. `<main>` (now `<WorkspaceMain>`, see that component's own
        // file-header comment) does the same per-route: capped to the
        // viewport with its own `overflow-y-auto` for chat (so chat's
        // internal, bounded-height scroll container further down --
        // components/chat/message-list.tsx's `overflow-y-auto` -- never
        // fights a second, page-level scroll container), or sized to its
        // own content for every other route, letting the row/document grow
        // and scroll naturally instead of `<main>` being forced to exactly
        // `h-svh` and leaving empty space below short content.
      }
      <div className="flex h-svh">
        <AppSidebar
          workspaceSlug={workspaceSlug}
          // F016: `workspaces` stays as the back-compat fallback prop (see
          // AppSidebar's own doc comment) -- the real switcher list is now
          // streamed in via `workspaceSwitcherSlot` below, so this array is
          // never actually rendered by this real call site.
          workspaces={[]}
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
          projects={sidebarProjects.map((project) => ({
            id: project.id,
            name: project.name,
            key: project.key,
            icon: project.icon,
            isFavorite: favoriteProjectIds.has(project.id),
          }))}
          // F016 (AS-017): every value below used to be awaited by this
          // layout body as part of the big `Promise.all` above. Each is
          // now a small async server component
          // (`components/nav/figures/*`), rendered here inside its own
          // `<Suspense fallback={null}>` so a slow one never blocks any
          // other figure or the rest of the page -- see each figure's own
          // file-header comment for exactly what it replaces.
          notificationBellSlot={
            <Suspense fallback={<NotificationBellSkeleton />}>
              <NotificationBellFigure
                workspaceSlug={workspaceSlug}
                workspaceId={activeWorkspace.id}
                currentUserId={user.id}
              />
            </Suspense>
          }
          workspaceSwitcherSlot={
            <Suspense fallback={<WorkspaceSwitcherSkeleton />}>
              <WorkspaceSwitcherFigure
                workspaceIds={workspaceIds}
                currentWorkspaceId={activeWorkspace.id}
                activeWorkspaceFallback={{
                  id: activeWorkspace.id,
                  name: activeWorkspace.name,
                  slug: activeWorkspace.slug,
                  logo_url: activeWorkspace.logo_url ?? null,
                }}
              />
            </Suspense>
          }
          approvalsBadge={
            <Suspense fallback={<NavBadgeSkeleton />}>
              <ApprovalsBadgeFigure workspaceId={activeWorkspace.id} />
            </Suspense>
          }
          requestsBadge={
            <Suspense fallback={<NavBadgeSkeleton />}>
              <RequestsBadgeFigure workspaceId={activeWorkspace.id} />
            </Suspense>
          }
          chatUnreadBadge={
            <Suspense fallback={<NavBadgeSkeleton />}>
              <ChatUnreadBadgeFigure workspaceId={activeWorkspace.id} />
            </Suspense>
          }
        />
        <div className="bg-background border border-border rounded-lg m-2 flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          <WorkspaceMain>
            <Suspense fallback={null}>
              <ClientPresentationBannerFigure
                supabase={supabase}
                workspaceId={activeWorkspace.id}
                workspaceSlug={workspaceSlug}
              />
            </Suspense>
            <AppHeader
              workspaceId={activeWorkspace.id}
              workspaceSlug={workspaceSlug}
              workspaceName={activeWorkspace.name}
            />
            {children}
          </WorkspaceMain>
        </div>
      </div>
      </BreadcrumbProvider>
      </WorkspacePresenceProvider>
    </MembershipProvider>
  );
}
