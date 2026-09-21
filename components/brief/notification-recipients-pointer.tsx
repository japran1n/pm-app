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
    <span
      data-testid="notification-recipients-pointer"
      className="inline-flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
    >
      {uniqueNames.length > 0 ? (
        <>
          Notifies:{" "}
          <span className="font-medium text-foreground">{uniqueNames.join(", ")}</span>
        </>
      ) : (
        "No notification recipients"
      )}{" "}
      &middot;{" "}
      <Link
        href={`/w/${workspaceSlug}/projects/${projectId}/settings`}
        className="underline-offset-4 hover:text-foreground hover:underline"
      >
        Manage
      </Link>
    </span>
  );
}
