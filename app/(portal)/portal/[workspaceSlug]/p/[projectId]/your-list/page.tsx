import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";

import { getClientDeliverablesForPortal } from "@/lib/queries/deliverables";
import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { StatusDistribution } from "@/components/portal/status-distribution";
import { DeliverableRow } from "@/components/portal/deliverable-row";
import type { ClientBucket } from "@/components/portal/status-label";
import type { PortalDeliverable } from "@/lib/queries/deliverables";

// F014 (missions/20260903-portal, AS-029, AS-030, AS-031): the Your list
// view — replaces F003's `PortalComingSoon` stub, the same "re-resolve the
// project via getPortalProjects, don't trust the URL alone" convention
// every sibling route under this layout already follows (see e.g.
// pages/page.tsx's own comment).
//
// AS-029: the progress header and the two lists below all read from ONE
// `getClientDeliverablesForPortal` call — never a second, independently
// computed count that could disagree with what the lists actually show.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// The progress header's four segments reuse F005's own `StatusDistribution`
// component and its four existing buckets (this feature's own spec: "Same
// status-distribution component F005 built; do not write a second one"),
// mapped onto this table's five-value `state` column:
//   - accepted/waived -> done (settled, nothing left to do)
//   - delivered       -> progress (sent, awaiting our review)
//   - not_started/in_progress, not yet due -> waiting (still open, on the
//     client)
//   - not_started/in_progress, past due    -> blocked (past due)
// This mapping is also what each outstanding row's own left-rule token
// (blocked/waiting) is derived from — same classification, one place.
function classifyBucket(deliverable: PortalDeliverable, today: string): ClientBucket {
  if (deliverable.state === "accepted" || deliverable.state === "waived") return "done";
  if (deliverable.state === "delivered") return "progress";
  return deliverable.dueAt && deliverable.dueAt < today ? "blocked" : "waiting";
}

export default async function PortalYourListPage({
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

  const result = await getClientDeliverablesForPortal(projectId);

  if (!result.ok) {
    return (
      <EmptyState
        icon={ListChecks}
        title="We couldn't load your list."
        description="Something went wrong loading this project's deliverables. Try refreshing the page."
        testId="your-list-error"
      />
    );
  }

  const deliverables = result.data;

  if (deliverables.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Nothing on your list yet."
        description="Once the team adds something they need from you, it will show up here."
        testId="your-list-empty"
      />
    );
  }

  const today = todayIso();

  const counts: Record<ClientBucket, number> = {
    waiting: 0,
    progress: 0,
    blocked: 0,
    done: 0,
  };
  for (const deliverable of deliverables) {
    counts[classifyBucket(deliverable, today)] += 1;
  }

  const settled = deliverables.filter(
    (d) => d.state === "accepted" || d.state === "waived",
  );
  const outstanding = deliverables
    .filter((d) => d.state !== "accepted" && d.state !== "waived")
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    });

  const deliveredCount = counts.done;
  const totalCount = deliverables.length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">
          {deliveredCount} of {totalCount} delivered
        </p>
        <StatusDistribution counts={counts} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Past due and upcoming</h2>
        {outstanding.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing open right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {outstanding.map((deliverable) => (
              <DeliverableRow
                key={deliverable.id}
                deliverable={deliverable}
                today={today}
                variant="outstanding"
              />
            ))}
          </ul>
        )}
      </div>

      {settled.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Delivered and accepted</h2>
          <ul className="flex flex-col gap-2">
            {settled.map((deliverable) => (
              <DeliverableRow
                key={deliverable.id}
                deliverable={deliverable}
                today={today}
                variant="settled"
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
