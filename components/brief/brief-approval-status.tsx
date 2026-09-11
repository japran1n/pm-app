import Link from "next/link";

// F078 (AS-152): "brief approvals appear in a dedicated discovery
// approvals section" -- a small, read-only status line on the brief team
// page (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/
// page.tsx) showing where the request created by F074's
// requestBriefApproval currently stands, with a link through to the
// workspace-wide approvals queue (app/(workspace)/w/[workspaceSlug]/
// approvals/page.tsx, getOpenApprovalsForWorkspace) where every
// approval_requests row -- including this one, since it is inserted
// with subject_type: 'doc' like any other doc approval -- already
// appears without any brief-specific carve-out.
export type BriefApprovalStatusProps = {
  workspaceSlug: string;
  state: "pending" | "approved" | "changes_requested" | "withdrawn" | null;
};

const STATE_LABEL: Record<
  NonNullable<BriefApprovalStatusProps["state"]>,
  string
> = {
  pending: "Approval requested",
  approved: "Approved",
  changes_requested: "Changes requested",
  withdrawn: "Approval withdrawn",
};

export function BriefApprovalStatus({ workspaceSlug, state }: BriefApprovalStatusProps) {
  if (!state) return null;

  return (
    <div
      data-testid="brief-approval-status"
      className="mb-4 flex items-center justify-end gap-2 text-sm text-muted-foreground"
    >
      <span>{STATE_LABEL[state]}</span>
      <Link
        href={`/w/${workspaceSlug}/approvals`}
        className="underline-offset-4 hover:text-foreground hover:underline"
      >
        View in approvals
      </Link>
    </div>
  );
}
