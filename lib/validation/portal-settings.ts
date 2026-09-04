import { z } from "zod";

// F080 (missions/20260903-portal, hardening): validates the two writes
// this feature adds — flipping `projects.portal_enabled` and editing the
// five launch/warranty fields the portal's own launch-day card reads
// (`target_launch_date`, `launch_confidence`, `launch_note`,
// `warranty_until`, `warranty_terms`). Mirrors lib/validation/metrics.ts's
// file shape — every action in lib/actions/portal-settings.ts
// re-validates with these schemas server-side.

export const setPortalEnabledSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  enabled: z.boolean(),
});

export type SetPortalEnabledInput = z.infer<typeof setPortalEnabledSchema>;

// Matches `projects_launch_confidence_check`
// (20260909010000_portal_foundations.sql) — the only three values the
// column accepts, read off that constraint rather than invented.
export const launchConfidenceSchema = z.enum(["on_track", "at_risk", "slipped"]);

// Plain YYYY-MM-DD string, matching the `date` column type — same
// convention as lib/validation/metrics.ts's metricDateSchema.
const portalDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
  .nullable();

const launchNoteSchema = z
  .string()
  .trim()
  .max(2000, "Note must be 2000 characters or fewer.")
  .nullable();

const warrantyTermsSchema = z
  .string()
  .trim()
  .max(2000, "Warranty terms must be 2000 characters or fewer.")
  .nullable();

export const updateProjectLaunchSchema = z
  .object({
    projectId: z.string().uuid("Invalid project."),
    targetLaunchDate: portalDateSchema,
    launchConfidence: launchConfidenceSchema.nullable(),
    launchNote: launchNoteSchema,
    warrantyUntil: portalDateSchema,
    warrantyTerms: warrantyTermsSchema,
  })
  // A lowered confidence with no explanation is an alarm with no
  // instruction (this feature's own clarified spec) — require a
  // non-empty note whenever confidence isn't the on-track value.
  .refine(
    (input) =>
      !input.launchConfidence ||
      input.launchConfidence === "on_track" ||
      !!input.launchNote?.trim(),
    {
      message:
        "Add a note explaining the delay or risk whenever confidence isn't \"On track\".",
      path: ["launchNote"],
    },
  );

export type UpdateProjectLaunchInput = z.infer<typeof updateProjectLaunchSchema>;
