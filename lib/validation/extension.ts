import { z } from "zod";

// F281 (AS-532/AS-533/AS-538): validates the body of
// app/(auth)/extension-connect/exchange/route.ts, the one narrow endpoint
// the extension calls to redeem a one-time handoff token for a session.
// Identity is never trusted from this payload — the token itself is the
// only thing that determines who the resulting session belongs to; see
// lib/extension-handoff.ts.
export const extensionHandoffExchangeSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "token is required.")
    .max(4096, "token is too long."),
});

export type ExtensionHandoffExchangeInput = z.infer<
  typeof extensionHandoffExchangeSchema
>;

// F292 (AS-558, AS-561, AS-562, AS-572): validates the body of
// app/api/extension/tasks/route.ts, the one narrow endpoint the QA feedback
// extension calls to create a real task from a captured report.
//
// Only the fields lib/actions/tasks.ts's createTask/createTaskForUser
// actually needs today are accepted here — no identity field (author is
// resolved from the verified bearer JWT, never trusted from this body; see
// the route handler), and no screenshot/annotation/console/network capture
// payload yet. F293-F295 (screenshot+annotation upload, console capture,
// network capture) are expected to extend this schema with additional
// optional fields (e.g. an attachment id/URL already uploaded via the
// existing attachments bucket, a `consoleLog`/`networkLog` blob) once those
// features exist — deliberately not built ahead of time here.
// F293 (AS-555, AS-556): extends the schema with the report form's
// remaining fields — status/priority/assigneeId/dueDate — mirroring
// lib/validation/tasks.ts's createTaskSchema's own rules for these exact
// fields (same enum values, same default, same nullable/optional shape) so
// the extension route can never accept something the web app's own
// create-task path would reject. `createTaskForUser` re-validates all of
// this again against `createTaskSchema` itself (defense in depth, same as
// every other field) — this schema exists so a bad submission gets a 400
// with a specific message before that inner validation even runs.
export const extensionCreateTaskSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  title: z
    .string()
    .trim()
    .min(1, "Task title is required.")
    .max(500, "Task title must be 500 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(10000, "Description must be 10000 characters or fewer.")
    .optional()
    .nullable(),
  // AS-555 / audit SEC-EXT-06: statuses are per-project (`project_statuses`)
  // — the extension renders the chosen project's own columns from
  // GET /api/extension/context. Same relaxed shape as createTaskSchema:
  // any non-empty column name; createTaskForUser resolves it against the
  // project's real columns. Omitted = the server picks the project's
  // default (first not-started) column.
  status: z
    .string()
    .trim()
    .min(1, "Status is required.")
    .max(100, "Status must be 100 characters or fewer.")
    .optional(),
  // AS-556: matches `tasks_priority_check` (lib/validation/tasks.ts's
  // createTaskSchema).
  priority: z
    .enum(["urgent", "high", "medium", "low", "backlog"])
    .optional()
    .nullable(),
  assigneeId: z.string().uuid("Invalid assignee.").optional().nullable(),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date (YYYY-MM-DD).")
    .optional()
    .nullable(),
  taskTypeId: z.string().uuid("Invalid task type.").optional().nullable(),
});

export type ExtensionCreateTaskInput = z.infer<
  typeof extensionCreateTaskSchema
>;
