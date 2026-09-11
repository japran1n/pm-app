import Link from "next/link";

// F069 (AS-138): "the recipients of the change notification are
// configurable per project" -- F068's notifyDecisionOwnersOfAnswerChange
// (lib/notifications/fanout.ts) already reads project_decision_owners,
// which is per-project and editable through project settings' "Who
// approves what" (components/approvals/decision-owners.tsx). Rather than
// build a second, competing UI for the same table on the brief page,
// this is a read-only pointer: who currently gets notified, plus a link
// to where that list is managed.
export function NotificationRecipientsPointer({
  workspaceSlug,
  projectId,
  recipientNames,
}: {
  workspaceSlug: string;
  projectId: string;
  recipientNames: string[];
}) {
  const uniqueNames = [...new Set(recipientNames)];

  return (
    <div
      data-testid="notification-recipients-pointer"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm"
    >
      <span className="text-muted-foreground">
        {uniqueNames.length > 0 ? (
          <>
            Answer changes notify{" "}
            <span className="font-medium text-foreground">{uniqueNames.join(", ")}</span>.
          </>
        ) : (
          "No decision owners are set for this project yet, so answer changes notify no one."
        )}
      </span>
      <Link
        href={`/w/${workspaceSlug}/projects/${projectId}/settings`}
        className="shrink-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Manage notification recipients
      </Link>
    </div>
  );
}
