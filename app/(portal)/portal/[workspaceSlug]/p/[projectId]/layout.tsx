import { notFound, redirect } from "next/navigation";

import {
  getPortalCurrentUserProfile,
  getPortalProjects,
  isPortalProjectArchived,
} from "@/lib/queries/portal";
import { getClientVisiblePortalLinks, getClientVisibleStagingLinks } from "@/lib/queries/project-site";
import { getWaitingOnYouCount } from "@/lib/portal/waiting-on-you-count";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PortalSidebar, type PortalForYouBadge } from "@/components/portal/portal-sidebar";
import { PortalTopbar } from "@/components/portal/portal-topbar";
import { PortalTitleProvider } from "@/components/portal/portal-title-context";
import type { PortalKeyLink } from "@/components/portal/portal-link-strip";

// F003 (missions/20260903-portal, AS-001, AS-004, AS-005, AS-006): the
// prototype's own shell -- fixed-width sticky sidebar (brand, project
// card, the eight views, a footer) plus a sticky topbar over the view
// container. Every one of the eight views (`overview` at this segment's
// own index, `approvals`, `your-list`, `pages`, `hours`, `results`,
// `scope`, `site`) renders inside this layout.
//
// This is the ONE place a `projectId` route param exists in the portal's
// route tree, which is why the shell lives here rather than in the
// workspace-level `[workspaceSlug]/layout.tsx` above it (that layout has
// no project to scope a sidebar to -- see its own comment). This layout
// adds NO auth/role guard of its own: `[workspaceSlug]/layout.tsx`
// already ran first (unauthenticated -> /sign-in, unknown workspace ->
// notFound, non-client role -> redirect to /w/<slug>, AS-006) and wraps
// every route under it, this one included.
//
// Project resolution reuses `getPortalProjects` -- the exact same
// RLS-plus-`portal_enabled` filtered list the pre-existing
// `p/[projectId]/page.tsx` (now this segment's overview) already used to
// resolve a project by id. A project that doesn't exist, isn't shared
// with this client, or has `portal_enabled = false` is indistinguishable
// here (RLS/the filter simply never returned the row), so all three end
// at the same notFound() -- this is the AS-007 404 the failure test
// checks for, inherited from that existing pattern rather than
// reimplemented.
export default async function PortalProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const { supabase, user } = await getCurrentUser();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug, logo_url")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  // The outer layout already guarantees a signed-in user (redirects to
  // /sign-in otherwise); this defensively re-checks rather than
  // fabricating a placeholder identity for the sidebar footer.
  if (!user) redirect("/sign-in");

  const todayIso = new Date().toISOString().slice(0, 10);

  const [projects, waitingOnYouResult, profile, keyLinksResult, stagingLinksResult] = await Promise.all([
    getPortalProjects(workspace.id),
    getWaitingOnYouCount(projectId, todayIso),
    getPortalCurrentUserProfile(user.id),
    getClientVisiblePortalLinks(projectId),
    // F06 (SP-041): the sidebar's "Preview" row only shows once there is
    // at least one client-visible staging/live link -- same
    // `getClientVisibleStagingLinks` the staging page itself reads
    // (SP-040), never the unfiltered `getProjectStagingLinks`.
    getClientVisibleStagingLinks(projectId),
  ]);

  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    // P2-36: before throwing a 404, check whether the project was archived
    // (deleted_at IS NOT NULL). If so, send the client to a friendly
    // "project closed" page instead of a raw Next.js 404.
    const archived = await isPortalProjectArchived(workspace.id, projectId);
    if (archived) {
      // Route outside p/[projectId]/ so this layout does not run again and
      // cause an infinite redirect cycle.
      redirect(`/portal/${workspaceSlug}/closed/${projectId}`);
    }
    notFound();
  }

  // F005/F008 (AS-007): the "For you" nav badge's own single source of
  // truth -- a failed read renders no badge at all, never a fabricated
  // zero.
  const forYouBadge: PortalForYouBadge = waitingOnYouResult.ok
    ? { ok: true, total: waitingOnYouResult.data.total, overdue: waitingOnYouResult.data.overdue }
    : { ok: false };

  // F113 (client-portal-phase-2-plan.md item B): the topbar's fixed
  // Figma/staging/live strip, same place on every route. A failed read
  // degrades to an empty strip (no chips rendered at all) rather than
  // failing this whole shell — the strip is a convenience surface, the
  // rest of the portal must still render.
  const keyLinks: PortalKeyLink[] = keyLinksResult.ok
    ? keyLinksResult.data
        .filter((link) => link.kind === "figma" || link.kind === "staging" || link.kind === "live")
        .map((link) => ({ kind: link.kind as PortalKeyLink["kind"], label: link.label, url: link.url }))
    : [];

  const hasStagingPreview = stagingLinksResult.ok && stagingLinksResult.data.length > 0;

  return (
    // F006e (missions/20260903-portal, AS-004): `PortalTitleProvider`
    // lets the task-detail page (nested several levels down inside
    // `children`) announce its own task's title up to `PortalTopbar`
    // without either component needing to know about the other's data --
    // same "leaf announces itself upward" shape `BreadcrumbProvider`
    // already uses one level up in the app
    // (`app/(workspace)/w/[workspaceSlug]/layout.tsx`), for the same
    // reason. See `components/portal/portal-title-context.tsx`.
    <PortalTitleProvider>
      {/* P2-39: `h-svh overflow-hidden` is the scroll guard (mirrors the
          workspace shell's `flex h-svh`). The main content area below gets
          `overflow-y-auto` so vertical page content is still reachable;
          only unwanted horizontal growth is clipped. */}
      <div className="flex h-svh overflow-hidden flex-col md:flex-row">
        <PortalSidebar
          workspaceSlug={workspace.slug}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          workspaceLogoUrl={workspace.logo_url}
          projectId={project.id}
          projectName={project.name}
          hasMultipleProjects={projects.length > 1}
          forYouBadge={forYouBadge}
          billingModel={project.billingModel}
          hasStagingPreview={hasStagingPreview}
          currentUser={{
            id: user.id,
            name: profile?.displayName ?? null,
            email: user.email ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <PortalTopbar
            workspaceSlug={workspace.slug}
            projectId={project.id}
            projectName={project.name}
            targetLaunchDate={project.targetLaunchDate}
            launchConfidence={project.launchConfidence}
            keyLinks={keyLinks}
          />
          <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
        </div>
      </div>
    </PortalTitleProvider>
  );
}
