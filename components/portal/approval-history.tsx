// F009 (missions/20260903-portal, AS-026): the full decision history for
// the project -- what, decision type, decided by, outcome chip, date, and
// the note -- newest first. This is the record that ends "I never
// approved that", so every column the assertion names is rendered, not
// summarised away. Server Component: purely presentational over
// `ApprovalHistoryEntry[]` (lib/queries/approvals.ts), same "no client
// state needed" shape as components/portal/team-card.tsx.
import type { ApprovalHistoryEntry } from "@/lib/queries/approvals";
import { EmptyState } from "@/components/empty-state";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";
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
            <th className="px-4 py-2 font-medium">What</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Decided by</th>
            <th className="px-4 py-2 font-medium">Outcome</th>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2">{entry.title}</td>
              <td className="px-4 py-2">{DECISION_TYPE_LABEL[entry.decisionType]}</td>
              <td className="px-4 py-2">{entry.decidedByName ?? "—"}</td>
              <td className="px-4 py-2">
                <span
                  data-testid="approval-history-outcome"
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    entry.state === "approved"
                      ? "bg-status-done-bg text-status-done"
                      : entry.state === "changes_requested"
                        ? "bg-status-blocked-bg text-status-blocked"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {OUTCOME_LABEL[entry.state] ?? entry.state}
                </span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {entry.decidedAt ? formatDate(entry.decidedAt) : "—"}
              </td>
              <td className="max-w-xs truncate px-4 py-2 text-muted-foreground">
                {entry.decisionNote ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
