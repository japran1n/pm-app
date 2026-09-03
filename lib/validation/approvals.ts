import { z } from "zod";

// F008 (missions/20260903-portal, M2 — Approvals): validates the "Request
// client approval" dialog's submission (AS-019) and the withdraw action.
// Mirrors lib/validation/phases.ts's file shape — every action in
// lib/actions/approvals.ts re-validates with these schemas server-side,
// per this repo's "the client-side check never stands alone" convention.
//
// Shape matches `approval_requests_subject_shape_check` and the enum
// CHECK constraints in supabase/migrations/20260916010000_approval_requests
// .sql exactly: subject_id required unless subject_type is 'artifact',
// artifact_url required only when it is. 'phase' is a valid subject_type
// at the DB layer (a future feature may raise an approval against a
// project_phase directly) but this feature's dialog only ever raises
// 'task' | 'doc' | 'artifact' — those are the only three entry points the
// spec names — so the input schema deliberately narrows to those three
// rather than accepting 'phase' from a form this feature never renders.

const decisionTypeSchema = z.enum([
  "content",
  "brand",
  "technical",
  "commercial",
]);

export type ApprovalDecisionTypeInput = z.infer<typeof decisionTypeSchema>;

const subjectTypeSchema = z.enum(["task", "doc", "artifact"]);

const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title must be 200 characters or fewer.");

// The "message to the client" field. Matches `approval_requests.description`
// (plain nullable text column, no length constraint in the migration) —
// capped here the same way every other free-text field in this codebase is
// (see lib/validation/phases.ts's phaseClientDescriptionSchema).
const messageSchema = z
  .string()
  .trim()
  .max(4000, "Message must be 4000 characters or fewer.");

const dueAtSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).");

// Matches the app's Storage upload conventions (task-attachments bucket is
// reused for the doc-body snapshot) — no fetch of this URL ever happens
// server-side (SSRF), so validation here is shape-only: a plausible http(s)
// URL, capped length.
const artifactUrlSchema = z
  .string()
  .trim()
  .url("Enter a valid URL.")
  .max(2000, "URL must be 2000 characters or fewer.")
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "The URL must start with http:// or https://.",
  );

export const requestApprovalSchema = z
  .object({
    projectId: z.string().uuid("Invalid project."),
    subjectType: subjectTypeSchema,
    // Required for 'task'/'doc', ignored for 'artifact' — enforced below.
    subjectId: z.string().uuid("Invalid subject.").nullable().optional(),
    // Required for 'artifact', ignored otherwise — enforced below.
    artifactUrl: artifactUrlSchema.nullable().optional(),
    title: titleSchema,
    message: messageSchema.nullable().optional(),
    decisionType: decisionTypeSchema,
    dueAt: dueAtSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.subjectType === "artifact") {
      if (!value.artifactUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["artifactUrl"],
          message: "A URL is required for an artifact approval.",
        });
      }
    } else if (!value.subjectId) {
      ctx.addIssue({
        code: "custom",
        path: ["subjectId"],
        message: "A subject is required.",
      });
    }
  });

export type RequestApprovalInput = z.infer<typeof requestApprovalSchema>;

// `requestApprovalSchema` is wrapped in `.superRefine`, which returns a
// ZodEffects — `.pick()` isn't available on it (unlike
// lib/validation/phases.ts's plain z.object schemas, which
// getProjectPhaseOptions picks `projectId` off directly). A standalone
// plain-object schema for the two read-only actions that only need a
// project id (getDecisionOwnersForDialog) avoids that trap.
export const projectIdSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
});

export type ProjectIdInput = z.infer<typeof projectIdSchema>;

export const withdrawApprovalSchema = z.object({
  requestId: z.string().uuid("Invalid approval request."),
});

export type WithdrawApprovalInput = z.infer<typeof withdrawApprovalSchema>;

// F008 section 4: the "Who approves what" settings row — one
// project_decision_owners upsert (or delete, when userId is null) per
// decision type.
export const setDecisionOwnerSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  decisionType: decisionTypeSchema,
  userId: z.string().uuid("Invalid member.").nullable(),
});

export type SetDecisionOwnerInput = z.infer<typeof setDecisionOwnerSchema>;
