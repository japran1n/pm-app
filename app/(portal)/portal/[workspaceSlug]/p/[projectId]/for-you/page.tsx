import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileQuestion, ListChecks } from "lucide-react";

import {
  getApprovalHistory,
  getDecisionOwners,
  getOpenApprovalsForClient,
} from "@/lib/queries/approvals";
import { getClientDeliverablesForPortal } from "@/lib/queries/deliverables";
import { getPortalProjects } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import {
  buildForYouItems,
  countForYouItems,
  filterForYouItems,
  parseForYouFilter,
  settledDeliverables,
  type ForYouFilter,
} from "@/lib/portal/build-for-you-items";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ForYouScrollToItem } from "@/components/portal/for-you-scroll-to-item";
import { ApprovalCard } from "@/components/portal/approval-card";
import { ApprovalHistory } from "@/components/portal/approval-history";
import { DeliverableRow } from "@/components/portal/deliverable-row";
import { cn } from "@/lib/utils";

// Mission 20260914-portal-simplify, F006 (AS-008, AS-009, AS-010, AS-011):
// the "For you" inbox -- open decisions (`approval_requests`) and
// outstanding materials (`client_deliverables`) merged into one list,
// soonest due first, overdue flagged, with All/Decisions/Materials filter
// chips. Deliberately does NOT re-implement approve/ask-for-changes or
// upload -- each row renders the existing `ApprovalCard` (decision owner
// gating, "Only <name> can decide this" hint, and all of that component's
// optimistic/settle-in-place behaviour, unchanged) or `DeliverableRow`
// (upload control / "waiting for us to check it" / returned note,
// unchanged) exactly as approvals/page.tsx and your-list/page.tsx already
// do. This route is new; the old `p/approvals` and `p/your-list` routes
// this supersedes are left in place until F009 redirects them -- per this
// feature's own "do not yet change the sidebar or remove old routes"
// instruction.
//
// Project resolution goes through `getPortalProjects`, the same
// RLS + `portal_enabled` filtered list every other portal view in this
// segment uses (see e.g. site/page.tsx's own comment) -- one visibility
// path, never a second lookup this route could disagree with.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const FILTER_CHIPS: { value: ForYouFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "decisions", label: "Decisions" },
  { value: "materials", label: "Materials" },
];

export default async function PortalForYouPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ filter?: string; approvalId?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const { filter: rawFilter, approvalId: highlightApprovalId } = await searchParams;
  const filter = parseForYouFilter(rawFilter);

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  // AS-011: independently failable -- a broken read from any ONE of these
  // four never hides what the other three loaded successfully (same
  // "Couldn't load" convention approvals/page.tsx already uses for its
  // own three sections).
  const [approvalsResult, deliverablesResult, historyResult, ownersResult] = await Promise.all([
    getOpenApprovalsForClient(project.id),
    getClientDeliverablesForPortal(project.id),
    getApprovalHistory(project.id),
    getDecisionOwners(project.id),
  ]);

  const owners = ownersResult.ok ? ownersResult.data : [];
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner]));

  const today = todayIso();
  const openApprovals = approvalsResult.ok ? approvalsResult.data : [];
  const deliverables = deliverablesResult.ok ? deliverablesResult.data : [];

  const items = buildForYouItems(openApprovals, deliverables, today);
  const counts = countForYouItems(items);
  const visibleItems = filterForYouItems(items, filter);

  const bothFailed = !approvalsResult.ok && !deliverablesResult.ok;
  const settled = settledDeliverables(deliverables);

  return (
    <div className="flex flex-col gap-8">
      {highlightApprovalId && <ForYouScrollToItem targetId={`approval-${highlightApprovalId}`} />}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          For you
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything the team needs from you, soonest first.
        </p>
      </div>

      {bothFailed ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load your For you list"
          description="Something went wrong loading this project's decisions and materials. Try refreshing the page."
          testId="for-you-error"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2" data-testid="for-you-filter-chips">
            {FILTER_CHIPS.map((chip) => {
              const count =
                chip.value === "all"
                  ? counts.all
                  : chip.value === "decisions"
                    ? counts.decisions
                    : counts.materials;
              const isActive = filter === chip.value;
              const href =
                chip.value === "all"
                  ? `/portal/${workspaceSlug}/p/${projectId}/for-you`
                  : `/portal/${workspaceSlug}/p/${projectId}/for-you?filter=${chip.value}`;
              return (
                <Link
                  key={chip.value}
                  href={href}
                  data-testid={`for-you-chip-${chip.value}`}
                  data-active={isActive ? "true" : "false"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-border-hover",
                  )}
                >
                  {chip.label}
                  <span className="font-mono text-xs">{count}</span>
                </Link>
              );
            })}
          </div>

          {!approvalsResult.ok && (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load decisions"
              description="Something went wrong loading this project's open decisions. Materials below are unaffected. Try refreshing the page."
              testId="for-you-decisions-error"
            />
          )}
          {!deliverablesResult.ok && (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load materials"
              description="Something went wrong loading this project's outstanding materials. Decisions above are unaffected. Try refreshing the page."
              testId="for-you-materials-error"
            />
          )}

          {visibleItems.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing is waiting on you."
              description="The team will let you know when that changes."
              testId="for-you-empty"
            />
          ) : (
            <ul className="flex flex-col gap-4" data-testid="for-you-list">
              {visibleItems.map((item) => (
                <li
                  key={`${item.kind}-${item.id}`}
                  id={item.kind === "decision" ? `approval-${item.id}` : undefined}
                  className="flex flex-col gap-2 scroll-mt-24"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={item.kind === "decision" ? "default" : "secondary"}>
                      {item.kind === "decision" ? "Decision" : "Material"}
                    </Badge>
                    {item.overdue && <Badge variant="destructive">Overdue</Badge>}
                  </div>
                  {item.kind === "decision" ? (
                    <ApprovalCard
                      approval={item.approval}
                      workspaceSlug={workspace.slug}
                      projectId={project.id}
                      isOwner={ownerByType.get(item.approval.decisionType)?.userId === user?.id}
                      ownerName={ownerByType.get(item.approval.decisionType)?.name ?? null}
                      ownerId={ownerByType.get(item.approval.decisionType)?.userId ?? null}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <ul>
                        <DeliverableRow deliverable={item.deliverable} today={today} variant="outstanding" />
                      </ul>
                      <div className="flex justify-end">
                        <Link
                          href={`/portal/${workspaceSlug}/p/${projectId}/conversation`}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <FileQuestion className="size-3.5" aria-hidden="true" />
                          Ask a question
                        </Link>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="flex flex-col gap-4 rounded-lg border border-border p-4" data-testid="for-you-history">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Completed &amp; decision history
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Delivered materials</h2>
            {!deliverablesResult.ok ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load delivered materials"
                description="Something went wrong loading this project's delivered materials. Try refreshing the page."
                testId="for-you-history-materials-error"
              />
            ) : settled.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="Nothing delivered yet"
                description="Materials you've sent and the team has accepted will show up here."
                testId="for-you-history-materials-empty"
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {settled.map((deliverable) => (
                  <DeliverableRow key={deliverable.id} deliverable={deliverable} today={today} variant="settled" />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Decision history</h2>
            {!historyResult.ok ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load decision history"
                description="Something went wrong loading this project's decision history. Try refreshing the page."
                testId="for-you-history-decisions-error"
              />
            ) : (
              <ApprovalHistory entries={historyResult.data} />
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
