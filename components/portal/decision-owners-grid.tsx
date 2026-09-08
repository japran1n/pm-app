// F009 (missions/20260903-portal): "who approves what" -- this project's
// configured decision types (`project_decision_types`, customizable per
// project — no longer a fixed four) with their named owner, from
// `project_decision_owners` (lib/queries/approvals.ts's `getDecisionOwners`).
// A type with no owner says so plainly rather than showing an empty cell
// (this feature's own explicit instruction).
//
// F085 (missions/20260903-portal audit, defect 6): "No owner assigned"
// used to stop there -- a client reading it has no way to know who could
// actually assign one. There is no per-type contact to name (that is
// exactly what's missing), so the honest next line names the team, not
// an individual, as who to raise it with.
//
// Redesign (2026-09-07, user request): four full-width cards took up a
// lot of vertical space to convey four short facts. This renders the
// same data as a single compact, wrapping row -- "Content -> Nina Maric"
// style chips -- so it reads at a glance and can sit above "Open
// approvals" without pushing it down the page.
import type { PortalDecisionOwner, ProjectDecisionType } from "@/lib/queries/approvals";
import { UserAvatar, personLabel } from "@/components/user-avatar";

export function DecisionOwnersGrid({
  decisionTypes,
  owners,
}: {
  decisionTypes: ProjectDecisionType[];
  owners: PortalDecisionOwner[];
}) {
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner]));

  if (decisionTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This project hasn&apos;t set up any decision types yet.
      </p>
    );
  }

  return (
    <div
      data-testid="decision-owners-grid"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5"
    >
      {decisionTypes.map((type) => {
        const owner = ownerByType.get(type.name);
        return (
          <div key={type.id} className="flex items-center gap-1.5 text-xs sm:text-sm">
            <span className="font-medium text-muted-foreground">{type.name}</span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            {owner ? (
              <span className="flex items-center gap-1.5 font-medium">
                <UserAvatar
                  person={{
                    id: owner.userId,
                    name: owner.name,
                    email: null,
                    avatarUrl: owner.avatarUrl,
                  }}
                  size="sm"
                />
                {personLabel({ id: owner.userId, name: owner.name, email: null })}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground">
                <span>No owner assigned</span>
                <span className="hidden sm:inline">— raise it with your project team.</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
