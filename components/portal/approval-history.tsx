// F009 (missions/20260903-portal, AS-026): the full decision history for
// the project -- what, decision type, decided by, outcome chip, date, and
// the note -- newest first. This is the record that ends "I never
// approved that", so every column the assertion names is rendered, not
// summarised away. Server Component: purely presentational over
// `ApprovalHistoryEntry[]` (lib/queries/approvals.ts), same "no client
// state needed" shape as components/portal/team-card.tsx.
import type { ApprovalHistoryEntry } from "@/lib/queries/approvals";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { formatDate } from "@/lib/format";

const DECISION_TYPE_LABEL: Record<ApprovalHistoryEntry["decisionType"], string> = {
  content: "Content",
  brand: "Brand",
  technical: "Technical",
  commercial: "Commercial",
};

const OUTCOME_LABEL: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  withdrawn: "Withdrawn",
};

export function ApprovalHistory({ entries }: { entries: ApprovalHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No decisions yet"
        description="Once a request is approved or changes are requested, it shows up here."
        testId="approval-history-empty"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table data-testid="approval-history-table" className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
            <th className="py-2 pl-6 pr-4 font-medium lg:pl-8">What</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Decided by</th>
            <th className="px-4 py-2 font-medium">Outcome</th>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="py-2 pl-4 pr-6 font-medium lg:pr-8">Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border last:border-0">
              <td className="py-2 pl-6 pr-4 lg:pl-8">{entry.title}</td>
              <td className="px-4 py-2">{DECISION_TYPE_LABEL[entry.decisionType]}</td>
              <td className="px-4 py-2">{entry.decidedByName ?? "—"}</td>
              <td className="px-4 py-2">
                <Badge
                  data-testid="approval-history-outcome"
                  className={
                    entry.state === "approved"
                      ? "text-status-done"
                      : entry.state === "changes_requested"
                        ? "text-status-blocked"
                        : undefined
                  }
                  variant={
                    entry.state === "approved"
                      ? "default"
                      : entry.state === "changes_requested"
                        ? "default"
                        : "secondary"
                  }
                >
                  {OUTCOME_LABEL[entry.state] ?? entry.state}
                </Badge>
              </td>
              <td className="px-4 py-2 font-mono text-muted-foreground">
                {entry.decidedAt ? formatDate(entry.decidedAt) : "—"}
              </td>
              <td className="max-w-xs truncate py-2 pl-4 pr-6 text-muted-foreground lg:pr-8">
                {entry.decisionNote ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
