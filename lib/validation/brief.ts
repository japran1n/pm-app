import { z } from "zod";

// Validates write-side input for the brief questionnaire editor (F049,
// AS-101, AS-112). Mirrors the tech-decisions.md file-layout convention
// established by lib/validation/projects.ts / lib/validation/tasks.ts.
//
// Column shapes taken from the real, already-applied migration
// (supabase/migrations/20261122010000_f044_brief_tables.sql), not a
// guessed shape: `brief_questions` has `prompt` (text, not-empty CHECK),
// `category` (nullable text), `answer_type` (CHECK'd enum), `help_text`
// (nullable text), `required` (bool, default false), `options`
// (nullable text[]), `position` (double precision).
//
// AS-112: prompt is required and cannot be empty (trimmed) -- mirrors the
// `brief_questions_prompt_not_empty` CHECK constraint from that migration,
// which is the real enforcement boundary; this schema exists so a bad
// submission is rejected before ever reaching the database, per AS-146's
// established "generic user-facing errors, validated before the DB"
// convention used throughout lib/actions/.
export const briefQuestionAnswerTypeSchema = z.enum([
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
]);

export const createQuestionSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "Question prompt is required.")
    .max(2000, "Question prompt must be 2000 characters or fewer."),
  category: z
    .string()
    .trim()
    .min(1, "Category is required.")
    .max(200, "Category must be 200 characters or fewer."),
  answerType: briefQuestionAnswerTypeSchema,
  helpText: z
    .string()
    .trim()
    .max(2000, "Help text must be 2000 characters or fewer.")
    .optional()
    .nullable(),
  required: z.boolean().default(false),
  // Only meaningful for single_choice/multi_choice, but this schema does
  // not cross-validate answerType <-> options presence -- the DB has no
  // such CHECK either (verified live in 20261122010000), so this stays a
  // plain optional array here too, matching the real enforcement
  // boundary rather than inventing a stricter one.
  options: z.array(z.string().trim().min(1)).optional(),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

// Partial of createQuestionSchema, per spec. `.partial()` on a schema with
// a `.default()` field keeps that field optional (undefined) rather than
// forcing the default in -- correct here, since an update call omitting
// `required` must leave the existing DB value untouched, not reset it to
// false.
export const updateQuestionSchema = createQuestionSchema.partial();

export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const reorderQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().uuid("Invalid question id."),
        position: z.number(),
      }),
    )
    .min(1, "At least one question is required to reorder."),
});

export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;
