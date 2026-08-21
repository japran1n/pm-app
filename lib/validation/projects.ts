import { z } from "zod";

// Validates create-project input (AS-025, AS-026, AS-035). Mirrors the
// tech-decisions.md file-layout convention established by
// lib/validation/workspaces.ts.
//
// AS-026: name is required and cannot be empty (trimmed).
// AS-035: end_date, if set, cannot be earlier than start_date, if set — this
// is a client-side pre-check mirroring the DB CHECK constraint
// `projects_end_date_after_start_date` from F024's migration
// (supabase/migrations/20260818004413_create_projects.sql). The DB
// constraint is the real enforcement boundary; this schema exists so a bad
// submission is rejected before ever reaching the database, per AS-146.
export const createProjectSchema = z
  .object({
    workspaceId: z.string().uuid("Invalid workspace."),
    name: z
      .string()
      .trim()
      .min(1, "Project name is required.")
      .max(200, "Project name must be 200 characters or fewer."),
    description: z
      .string()
      .trim()
      .max(4000, "Description must be 4000 characters or fewer.")
      .optional()
      .nullable(),
    // Plain YYYY-MM-DD strings, matching the `date` column type — no
    // timezone/time-of-day component to avoid off-by-one issues comparing
    // against the DB's `date` columns.
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date (YYYY-MM-DD).")
      .optional()
      .nullable(),
    endDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid end date (YYYY-MM-DD).")
      .optional()
      .nullable(),
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return data.endDate >= data.startDate;
    },
    {
      message: "End date cannot be earlier than the start date.",
      path: ["endDate"],
    },
  );

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// Validates edit-project input (AS-029, AS-037). Partial update of the same
// fields as createProjectSchema minus workspaceId (workspaceId/projectId are
// passed separately as function args in editProject, not part of the
// user-editable field set) — name/description/startDate/endDate are all
// optional here since editProject supports partial updates, but if a field
// IS provided it must satisfy the same constraints as creation (AS-026's
// non-empty name constraint still applies if name is being changed).
export const editProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Project name is required.")
      .max(200, "Project name must be 200 characters or fewer.")
      .optional(),
    description: z
      .string()
      .trim()
      .max(4000, "Description must be 4000 characters or fewer.")
      .optional()
      .nullable(),
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date (YYYY-MM-DD).")
      .optional()
      .nullable(),
    endDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid end date (YYYY-MM-DD).")
      .optional()
      .nullable(),
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return data.endDate >= data.startDate;
    },
    {
      message: "End date cannot be earlier than the start date.",
      path: ["endDate"],
    },
  );

export type EditProjectInput = z.infer<typeof editProjectSchema>;

// Validates archive-project input (AS-030, AS-033). Same shape as
// deleteWorkspaceSchema's single-id validation in
// lib/validation/workspaces.ts.
export const archiveProjectSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  workspaceId: z.string().uuid("Invalid workspace."),
});

export type ArchiveProjectInput = z.infer<typeof archiveProjectSchema>;

// Validates restore-project input (F143: AS-252, AS-253). Same shape as
// archiveProjectSchema — restoring is the exact inverse mutation of
// archiving, over the same identity fields.
export const restoreProjectSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  workspaceId: z.string().uuid("Invalid workspace."),
});

export type RestoreProjectInput = z.infer<typeof restoreProjectSchema>;
