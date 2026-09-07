import { z } from "zod";

// Validates project-scoped custom field definitions
// (`project_custom_fields`, 20261115010000_project_custom_fields.sql) and
// their per-task values (`task_custom_field_values`, same migration).
// Mirrors lib/validation/statuses.ts's column-name/shape conventions.

const fieldNameSchema = z
  .string()
  .trim()
  .min(1, "Field name is required.")
  .max(100, "Field name must be 100 characters or fewer.");

// Matches `project_custom_fields_field_type_check`
// (20261115010000_project_custom_fields.sql).
export const customFieldTypeSchema = z.enum(["text", "number", "url", "checkbox"]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const createCustomFieldSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  name: fieldNameSchema,
  fieldType: customFieldTypeSchema,
});
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;

export const deleteCustomFieldSchema = z.object({
  fieldId: z.string().uuid("Invalid field."),
});
export type DeleteCustomFieldInput = z.infer<typeof deleteCustomFieldSchema>;

// `value` is stored as text regardless of `fieldType` (this migration's
// own "store as text, cast at the edges" convention — see its header
// comment). `null` explicitly clears the value, same convention as this
// codebase's other nullable-field actions (e.g. assignTaskSchema's
// `assigneeId`). Per-type shape is refined below so an obviously invalid
// value for a `number`/`url`/`checkbox` field is rejected server-side too
// (AS-146 "the client check never stands alone" convention), not just by
// the UI's own input type.
export const setTaskCustomFieldValueSchema = z
  .object({
    taskId: z.string().uuid("Invalid task."),
    fieldId: z.string().uuid("Invalid field."),
    fieldType: customFieldTypeSchema,
    value: z
      .string()
      .max(2000, "Value must be 2000 characters or fewer.")
      .nullable(),
  })
  .superRefine(({ fieldType, value }, ctx) => {
    if (value === null || value.trim() === "") return;

    if (fieldType === "number" && Number.isNaN(Number(value))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid number.",
        path: ["value"],
      });
    }

    if (fieldType === "checkbox" && value !== "true" && value !== "false") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid checkbox value.",
        path: ["value"],
      });
    }

    if (fieldType === "url") {
      try {
        new URL(value);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid URL.",
          path: ["value"],
        });
      }
    }
  });
export type SetTaskCustomFieldValueInput = z.infer<typeof setTaskCustomFieldValueSchema>;
