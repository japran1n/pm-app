import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Paperclip, Inbox } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { getClientVisiblePortalLinks, getClientVisiblePortalAccounts } from "@/lib/queries/project-site";
import { getClientVisibleDocs, getDocLinksForDocs } from "@/lib/queries/docs";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { LaunchDayCard } from "@/components/portal/launch-day-card";
import { ProjectLinksList } from "@/components/portal/project-links-list";
import { ProjectAccountsTable } from "@/components/portal/project-accounts-table";
import { ProjectGuidesList } from "@/components/portal/project-guides-list";

// F023 (missions/20260903-portal, AS-049, AS-050, AS-051): replaces
// F003's `PortalComingSoon` stub. Reads `getClientVisiblePortalLinks`/
// `getClientVisiblePortalAccounts` (both exported from
// lib/queries/project-site.ts by F025e; F022's unfiltered
// getProjectLinks/getProjectAccounts stay reserved for the team settings
// panel, see that file's own header) plus
// `getClientVisibleDocs` (lib/queries/docs.ts, further filtered
// client-side to `doc_kind === 'training'`) -- all three through the
// ordinary RLS-respecting server client. RLS already restricts a client
// caller to `client_visible = true` rows of a portal-enabled project it
// belongs to, but F025e double-guards all three the same way
// lib/queries/portal.ts:337-342 documents and every sibling portal query
// in this mission follows: each function also applies its own explicit
// `client_visible = true` predicate, so a link/account/doc with
// `client_visible = false` is never in the payload even for a team caller
// previewing the portal, not merely excluded by RLS for an actual client
// session.
//
// Also the entry point for Files (relocated here per F003b's own note
// that Files belongs inside "Your site") and for Requests, per this
// feature's own spec section 1.
export default async function PortalSitePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  // The launch card's own warranty fields -- read directly rather than
  // through getPortalProjects (whose own PortalProject shape has no other
  // caller that needs them), same pattern results/page.tsx already uses
  // for baseline_frozen_at. RLS already scopes this SELECT the same as
  // every other read on this page.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("warranty_until, warranty_terms")
    .eq("id", projectId)
    .maybeSingle();

  const [linksResult, accountsResult, guidesRaw] = await Promise.all([
    getClientVisiblePortalLinks(projectId),
    getClientVisiblePortalAccounts(projectId),
    getClientVisibleDocs(workspace.id, projectId).catch(() => null),
  ]);

  // A failed links/accounts read renders an honest "couldn't load" state,
  // never falling through the same empty-list branch as "genuinely
  // nothing shared yet" -- the same failure-as-reassuring-fact defect
  // results/page.tsx's own header comment describes and fixes for this
  // view's neighbour.
  if (!linksResult.ok || !accountsResult.ok || guidesRaw === null) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your site"
        description="Something went wrong loading this project's links, accounts, or guides. Try refreshing the page."
        testId="site-view-error"
      />
    );
  }

  const links = linksResult.data;
  const accounts = accountsResult.data;
  // Fix ("Your site" -> Guides was empty for demo project, F114 kind
  // gap): Guides used to be `doc_kind === 'training'` only. F114 added
  // `portal_guide` and `handover` as further client-facing writing kinds
  // (see project-guides-list.tsx's own header comment) -- a project
  // whose client-facing docs were entirely `portal_guide`/`handover`
  // (no `training` doc) showed nothing here even though that content
  // existed and rendered fine on the "How we work" route. Widened to
  // match, and each guide's `doc_links` (F114's manual link entries) are
  // fetched the same way `getHowWeWorkEntries` already does
  // (lib/queries/how-we-work.ts) rather than duplicating that query.
  const guideDocs = guidesRaw.filter(
    (doc) => doc.docKind === "training" || doc.docKind === "portal_guide" || doc.docKind === "handover",
  );
  const guideLinksByDoc = await getDocLinksForDocs(guideDocs.map((doc) => doc.id));
  const guides = guideDocs.map((doc) => ({
    ...doc,
    links: guideLinksByDoc.get(doc.id) ?? [],
  }));

  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;

  return (
    <div className="flex flex-col gap-8">
      <LaunchDayCard
        targetLaunchDate={project.targetLaunchDate}
        launchConfidence={project.launchConfidence}
        launchNote={project.launchNote}
        warrantyUntil={projectRow?.warranty_until ?? null}
        warrantyTerms={projectRow?.warranty_terms ?? null}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Links</h2>
        <ProjectLinksList links={links} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
        <ProjectAccountsTable accounts={accounts} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Guides</h2>
        <ProjectGuidesList guides={guides} />
      </section>

      {/* F023's own spec: Files (relocated by F003b) was "deliberately
          left out of the sidebar's eight views" and belongs here. `Files`
          was a TEMPORARY secondary sidebar entry (F006e) tagged for
          removal the moment this feature lands (see
          components/portal/portal-sidebar.tsx's own comment) -- its one
          entry point now lives here instead.
          Mission 20260914-portal-simplify, F009 (AS-017): the second
          "Requests" entry point here now points at "Messages"
          (`/conversation`, which folds requests in -- F007), since the
          old `/requests` route is itself a redirect now. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">More</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${basePath}/files`}
            className="hover-surface flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            data-testid="site-view-files-link"
          >
            <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
            Files
          </Link>
          <Link
            href={`${basePath}/conversation`}
            className="hover-surface flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            data-testid="site-view-messages-link"
          >
            <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
            Messages
          </Link>
        </div>
      </section>
    </div>
  );
}
