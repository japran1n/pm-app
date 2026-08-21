// F131: project_members Server Action validation (AS-224).
//
// Mirrors the shape/style of lib/validation/checklist.ts and
// lib/validation/dependencies.ts: one zod schema per action, uuid-checked
// ids, no free-form strings beyond the role enum.

import { z } from "zod";

export const addProjectMemberSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  userId: z.string().uuid("Invalid user."),
  projectRole: z.enum(["lead", "member"]).default("member"),
});

export const removeProjectMemberSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  userId: z.string().uuid("Invalid user."),
});

// F133: visibility-toggle action validation (AS-229's UI counterpart —
// the DB trigger `enforce_project_visibility_change_role` is the real
// boundary; this schema just keeps a bad value from ever reaching it).
export const updateProjectVisibilitySchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  visibility: z.enum(["workspace", "private"]),
});

export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type RemoveProjectMemberInput = z.infer<typeof removeProjectMemberSchema>;
export type UpdateProjectVisibilityInput = z.infer<
  typeof updateProjectVisibilitySchema
>;
