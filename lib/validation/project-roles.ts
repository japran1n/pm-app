import { z } from "zod";

import { PROJECT_ROLE_VALUES } from "@/lib/queries/project-roles";

// F112 (missions/20260903-portal): validates the project-settings "Team"
// editor's add/update/remove actions. Mirrors lib/validation/approvals.ts's
// file shape for `project_decision_owners` — every action in
// lib/actions/project-roles.ts re-validates with these schemas
// server-side, same "the client-side check never stands alone" convention.

const roleSchema = z.enum(PROJECT_ROLE_VALUES);

const noteSchema = z
  .string()
  .trim()
  .max(280, "Keep it to one line — 280 characters or fewer.")
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

export const projectIdSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
});

export const setProjectRoleSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  userId: z.string().uuid("Invalid member."),
  role: roleSchema,
  note: noteSchema,
});

export type SetProjectRoleInput = z.infer<typeof setProjectRoleSchema>;

export const removeProjectRoleSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  roleId: z.string().uuid("Invalid role."),
});

export type RemoveProjectRoleInput = z.infer<typeof removeProjectRoleSchema>;
