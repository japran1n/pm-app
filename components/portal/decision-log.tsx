// F015 (missions/20260903-portal, AS-044, AS-045): the Scope view's
// decision log — title, rationale, type chip, date, newest first. A
// `client_visible = false` row never reaches this component at all — RLS
// (`project_decisions_select_client`, 20260926010000) excludes it before
// `getProjectDecisions` ever fetches it (AS-045).
import { Badge } from "@/components/ui/badge";
import type { DecisionType, ProjectDecision } from "@/lib/queries/project-records";

const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  content: "Content",
  brand: "Brand",
  technical: "Technical",
  commercial: "Commercial",
};

function formatDate(iso: string): string {
  const isoWithTime = iso.includes("T") ? iso : `${iso}T00:00:00Z`;
  return new Date(isoWithTime).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function DecisionLog({ decisions }: { decisions: ProjectDecision[] }) {
  const sorted = [...decisions].sort((a, b) => (a.decidedOn < b.decidedOn ? 1 : -1));

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3" data-testid="decision-log">
      {sorted.map((decision) => (
        <li key={decision.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{decision.title}</p>
            <Badge variant="secondary">{DECISION_TYPE_LABELS[decision.decisionType]}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDate(decision.decidedOn)}
            </span>
          </div>
          {decision.rationale && (
            <p className="mt-2 text-sm text-muted-foreground">{decision.rationale}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
