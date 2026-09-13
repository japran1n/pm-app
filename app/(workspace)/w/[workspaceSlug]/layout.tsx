import { notFound, redirect, permanentRedirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
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
// F208 (AS-379): the sidebar's notification bell needs its initial
// unread-count + list server-fetched here, same "server-fetched in the
// layout, passed down as props" convention every other sidebar-fed value
// on this page already follows (currentUser, workspaces, isGuest).
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
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
// F253 (AS-491, AS-492, AS-493): the first-run guided tour, mounted once
// alongside the other persistent workspace chrome. `initialDismissed` is
// server-fetched here (same "server-fetched... passed down as typed
// props" pattern as everything else on this layout) so a returning user
// never sees a flash of the tour before a client-side check catches up.
import { OnboardingTour } from "@/components/onboarding/tour";
import { getTourStatus } from "@/lib/actions/onboarding-tour";
// F262 (AS-509, AS-511, AS-512, AS-513): the sidebar's own "Projects"
// section reuses the exact same RLS-backed, guest-scoped query the
// /projects page (F027) already calls — no second copy of the visibility
// rule, and per this feature's clarified caching note, one fetch per
// layout render (not a per-navigation client refetch).
import { getWorkspaceProjects, getFavoriteProjectIds } from "@/lib/queries/projects";
// F010 (AS-027): the "Approvals" nav item's badge count — same
// server-fetched-by-the-layout convention as every other sidebar figure
// on this page.
import { getOpenApprovalsForWorkspace } from "@/lib/queries/approvals";
import { getOpenClientRequestCountForWorkspace } from "@/lib/queries/client-requests";
// Feature request (sidebar unread badges): total unread chat messages
// across every channel the caller belongs to, for the sidebar's "Chat"
// nav item badge -- same non-fatal, fails-open-to-0 convention as
// openApprovals/openClientRequestCount above.
import { getWorkspaceChatUnreadTotal } from "@/lib/queries/chat";
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
    logger.error("WorkspaceLayout: failed to look up workspace by slug", { error: activeWorkspaceError });
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
  // notifications, tour status, sidebar projects, favorites, client count,
  // and project roles are all independent of each other once user +
  // activeWorkspace are known. This collapses 8 serial round-trips
  // (~300–640 ms on a hosted Supabase instance) into one parallel batch.
  const [
    { data: memberships, error: membershipsError },
    { data: currentUserProfile, error: currentUserProfileError },
    notificationsResult,
    tourStatusResult,
    sidebarProjectsResult,
    favoriteProjectIds,
    { count: clientMemberCount },
    { data: projectMemberRows, error: projectMemberRowsError },
    openApprovals,
    openClientRequestCount,
    upcomingClientPresentations,
    chatUnreadTotal,
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

    // F208 (AS-379): initial notification bell state. Non-fatal — function
    // already falls back to empty list / zero count internally.
    getNotificationsForWorkspace(activeWorkspace.id),

    // F253: first-run tour status. Fails open to "dismissed".
    getTourStatus(),

    // F262: sidebar projects. Fails open to empty list.
    getWorkspaceProjects(activeWorkspace.id).then(
      (projects) => ({ projects, error: null }),
      (error) => {
        logger.error("WorkspaceLayout: failed to look up workspace projects for sidebar", { error: error });
        return { projects: [] as Awaited<ReturnType<typeof getWorkspaceProjects>>, error };
      },
    ),

    // F263 (AS-510): favourite project ids. getFavoriteProjectIds already fails open.
    getFavoriteProjectIds(activeWorkspace.id),

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

    // F010 (AS-027): open-approvals count for the sidebar's "Approvals"
    // badge. Non-fatal — getOpenApprovalsForWorkspace already fails open
    // to an empty array internally (logging its own error), so a
    // failure here shows an un-badged nav item, never a broken layout.
    getOpenApprovalsForWorkspace(activeWorkspace.id),

    // F083: open (submitted/in_review) client-request count for the
    // sidebar's "Client requests" badge — same "non-fatal, fails open to
    // 0" convention as openApprovals above.
    getOpenClientRequestCountForWorkspace(activeWorkspace.id),

    // Client Presentation feature: "today"/"tomorrow" advance-notice
    // banner data. Already fails open to [] internally (see
    // getUpcomingClientPresentations' own doc comment), same "non-fatal"
    // convention as every other sidebar figure above.
    getUpcomingClientPresentations(supabase, activeWorkspace.id),

    // Feature request (sidebar unread badges): sums per-channel unread
    // counts for the sidebar's "Chat" badge. getWorkspaceChatUnreadTotal
    // wraps getWorkspaceChannels, which already fails open to [] (see that
    // function's own doc comment), so a failure here surfaces as an
    // un-badged nav item, not a broken layout.
    getWorkspaceChatUnreadTotal(activeWorkspace.id).catch((error) => {
      logger.error("WorkspaceLayout: failed to look up chat unread total for sidebar", { error });
      return 0;
    }),
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

  const { list: initialNotifications, unreadCount: initialUnreadCount } = notificationsResult;
  const tourDismissed = tourStatusResult.ok ? tourStatusResult.dismissed : true;

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

  // Workspaces list for the switcher — needs workspaceIds from memberships,
  // so runs after the parallel batch (single query, not a bottleneck).
  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, slug, logo_url")
        .in("id", workspaceIds)
        .order("name", { ascending: true })
    : { data: [], error: null };

  if (workspacesError) {
    logger.error("WorkspaceLayout: failed to look up member workspaces", { error: workspacesError });
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
      <OnboardingTour initialDismissed={tourDismissed} />
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
          projects={sidebarProjects.map((project) => ({
            id: project.id,
            name: project.name,
            key: project.key,
            icon: project.icon,
            isFavorite: favoriteProjectIds.has(project.id),
          }))}
          approvalsCount={openApprovals.length}
          requestsCount={openClientRequestCount}
          chatUnreadCount={chatUnreadTotal}
        />
        <div className="bg-background border border-border rounded-lg m-2 flex-1 min-h-0 min-w-0 flex flex-col">
          <WorkspaceMain>
            <ClientPresentationBanner
              presentations={upcomingClientPresentations}
              workspaceSlug={workspaceSlug}
            />
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
