import { notFound } from "next/navigation";
import { AlertTriangle, BookOpen } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { getHowWeWorkEntries } from "@/lib/queries/how-we-work";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { HowWeWorkList } from "@/components/portal/how-we-work-list";
import { HowWeWorkProcess } from "@/components/portal/how-we-work-process";

// A3 (Paket A, client-portal redesign): "How we work" used to be a
// section inside `site/page.tsx` (F114/F023); it now gets its own route
// under the portal's secondary nav (`portal-sidebar.tsx`'s
// `buildPortalSecondaryNavItems`) so it's reachable without scrolling
// through "Your site". Same auth/workspace-resolve/access-check pattern
// as `site/page.tsx` (RLS-respecting server client, `getPortalProjects`
// scoping to the caller's own projects, `notFound()` for anything
// outside that set) -- only the data this route needs changed, not how
// it's guarded.
//
// Visual redesign (see this feature's own handoff): the route used to
// render only the project-specific guides list below. It now opens with
// a static, non-task-linked hero + full-process storytelling section
// (`HowWeWorkProcess`) -- deliberately bigger and more illustrative than
// the compact, task-progress-driven "Where we are" timeline on Overview
// (`phase-timeline.tsx`), and NOT wired to this project's live phase/task
// state at all, per this feature's own clarified scope. The guides list
// (`HowWeWorkList`, unchanged, still fed by `getHowWeWorkEntries`) now
// renders inside a matching card frame instead of a bare `<ul>` under a
// plain `<h2>`.
export default async function PortalHowWeWorkPage({
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

  const howWeWork = await getHowWeWorkEntries(workspace.id, projectId).catch(() => null);

  if (howWeWork === null) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load how we work"
        description="Something went wrong loading this project's onboarding, feedback, and handover material. Try refreshing the page."
        testId="how-we-work-view-error"
      />
    );
  }

  return (
    <div className="flex flex-col gap-10" data-testid="how-we-work-page">
      <section
        data-testid="how-we-work-hero"
        className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-10"
      >
        <span className="text-tag font-medium uppercase tracking-wide text-muted-foreground">
          Kako radimo
        </span>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
          One process, start to finish -- no surprises along the way.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Every project we run follows the same eight-stage process, and every
          decision along the way gets written down where you can see it. You
          always know what stage you&rsquo;re in, what happens next, and why it
          matters -- from the first discovery call to the day we hand you the
          keys.
        </p>
      </section>

      <HowWeWorkProcess />

      <section
        data-testid="how-we-work-guides-section"
        className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Guides for this project</h2>
        </div>
        <HowWeWorkList entries={howWeWork.entries} />
      </section>
    </div>
  );
}
