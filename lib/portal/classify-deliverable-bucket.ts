// F016h (missions/20260903-portal, M3 remediation, AS-003): the shared
// deliverable-state -> `ClientBucket` classification originally defined
// (and tested) in `p/[projectId]/your-list/page.tsx`.
//
// Mission 20260914-portal-simplify, F009 (AS-017): `your-list/page.tsx`
// is now a redirect-only route (its own UI folded into the new "For you"
// page, F006) -- this function had a real, non-trivial test suite
// (`tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts`)
// keyed to AS-003 of an earlier mission, so it moved here rather than
// being deleted along with the page, per this feature's own "keep
// reusable components" instruction.
import { isDeliverablePastDue, type PortalDeliverable } from "@/lib/queries/deliverables";
import type { ClientBucket } from "@/components/portal/status-label";

export function classifyBucket(deliverable: PortalDeliverable, today: string): ClientBucket {
  if (deliverable.state === "accepted" || deliverable.state === "waived") return "done";
  if (isDeliverablePastDue(deliverable.state, deliverable.dueAt, today)) return "blocked";
  if (deliverable.state === "delivered") return "progress";
  return "waiting";
}
