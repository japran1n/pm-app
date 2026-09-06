import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { getHowWeWorkEntries } from "@/lib/queries/how-we-work";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { HowWeWorkList } from "@/components/portal/how-we-work-list";

// A3 (Paket A, client-portal redesign): "How we work" used to be a
// section inside `site/page.tsx` (F114/F023); it now gets its own route
// under the portal's secondary nav (`portal-sidebar.tsx`'s
// `buildPortalSecondaryNavItems`) so it's reachable without scrolling
// through "Your site". Same auth/workspace-resolve/access-check pattern
// as `site/page.tsx` (RLS-respecting server client, `getPortalProjects`
// scoping to the caller's own projects, `notFound()` for anything
// outside that set) -- only the data this route needs changed, not how
// it's guarded.
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
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">How we work</h2>
        <HowWeWorkList entries={howWeWork.entries} />
      </section>
    </div>
  );
}
