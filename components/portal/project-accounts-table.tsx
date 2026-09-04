// F023 (missions/20260903-portal, AS-050): the "Accounts" section of the
// portal's "Your site" view -- the table that answers "what do I
// actually own?". `accounts` has already been through
// `getProjectAccounts` (RLS-scoped to `client_visible = true` rows for a
// client caller) -- this component renders exactly what it is given, no
// second filter.
//
// Owner and status are the whole content, per this feature's own spec
// ("keep it plain") -- no credential/secret field exists on this row at
// all (the migration's `looks_like_credential` CHECK on `service`/`note`
// guarantees that server-side; this component doesn't need to guard
// against it, only display it).
import { KeyRound } from "lucide-react";

import type {
  ProjectAccount,
  ProjectAccountOwner,
  ProjectAccountStatus,
} from "@/lib/queries/project-site";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

const OWNER_LABEL: Record<ProjectAccountOwner, string> = {
  client: "You own this",
  agency: "We manage this",
};

const STATUS_LABEL: Record<ProjectAccountStatus, string> = {
  pending: "Pending",
  provisioned: "Provisioned",
  transferred: "Transferred",
};

const STATUS_VARIANT: Record<ProjectAccountStatus, "secondary" | "default" | "outline"> = {
  pending: "outline",
  provisioned: "secondary",
  transferred: "default",
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ProjectAccountsTable({ accounts }: { accounts: ProjectAccount[] }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No accounts shared yet."
        description="The services and accounts tied to this project will show up here once the team lists them."
        testId="project-accounts-empty"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="project-accounts-table">
      {accounts.map((account) => (
        <li
          key={account.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
          data-testid="project-account-row"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">{account.service}</p>
            <p className="text-tag text-muted-foreground">{OWNER_LABEL[account.owner]}</p>
            {account.note && (
              <p className="text-tag text-muted-foreground">{account.note}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {account.renewalDate && (
              <span className="text-tag text-muted-foreground">
                Renews {formatDate(account.renewalDate)}
              </span>
            )}
            <Badge variant={STATUS_VARIANT[account.status]}>
              {STATUS_LABEL[account.status]}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
