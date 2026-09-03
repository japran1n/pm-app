import { z } from "zod";

// F014 (missions/20260903-portal): validates the client-facing "mark
// delivered" action (AS-029, AS-030). Sibling to
// lib/validation/deliverables.ts (F013's team-side actions) rather than an
// addition to that file, since this is a different caller (a portal
// client, not a team member) with a deliberately narrower shape — no
// `decision` field exists here at all, unlike `decideDeliverableSchema`,
// because this action can only ever move a deliverable to `delivered`
// (see the migration's own header comment for why that is the actual
// enforcement of AS-030, not merely this schema's).
export const deliverPortalDeliverableSchema = z.object({
  deliverableId: z.string().uuid("Invalid deliverable."),
});

export type DeliverPortalDeliverableInput = z.infer<
  typeof deliverPortalDeliverableSchema
>;
