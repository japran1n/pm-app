// F009 (missions/20260903-portal): "who approves what" -- the four
// decision types with their named owner, from `project_decision_owners`
// (lib/queries/approvals.ts's `getDecisionOwners`). A type with no owner
// says so plainly rather than showing an empty cell (this feature's own
// explicit instruction).
import type { PortalDecisionOwner } from "@/lib/queries/approvals";
import { UserAvatar, personLabel } from "@/components/user-avatar";

const DECISION_TYPES: PortalDecisionOwner["decisionType"][] = [
  "content",
  "brand",
  "technical",
  "commercial",
];

const DECISION_TYPE_LABEL: Record<PortalDecisionOwner["decisionType"], string> = {
  content: "Content",
  brand: "Brand",
  technical: "Technical",
  commercial: "Commercial",
};

export function DecisionOwnersGrid({ owners }: { owners: PortalDecisionOwner[] }) {
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner]));

  return (
    <div data-testid="decision-owners-grid" className="grid gap-3 sm:grid-cols-2">
      {DECISION_TYPES.map((type) => {
        const owner = ownerByType.get(type);
        return (
          <div
            key={type}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"
          >
            <span className="text-sm font-medium">{DECISION_TYPE_LABEL[type]}</span>
            {owner ? (
              <span className="flex items-center gap-2 text-sm">
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
              <span className="text-sm text-muted-foreground">No owner assigned</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
