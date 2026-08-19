import { z } from "zod";

// Validates createDependency input (F156, AS-278). Mirrors the file-layout
// convention established by lib/validation/checklist.ts and
// lib/validation/comments.ts.
//
// The not-self rule (`blockingTaskId !== blockedTaskId`) mirrors the
// database's `task_dependencies_not_self` CHECK constraint (F155,
// AS-279) — that constraint is the real enforcement boundary; this schema
// exists so an obviously-invalid submission is rejected before ever
// reaching the database, per the AS-146 convention every other validation
// file in this codebase follows. It is deliberately NOT the cycle check:
// a same-task check needs no other rows and is safe to do client-side; a
// cycle check needs the full graph and MUST happen inside the same
// transaction as the write (see the migration's header comment) — doing
// any version of it here would reintroduce the exact TOCTOU bug this
// feature exists to close.
export const createDependencySchema = z
  .object({
    blockingTaskId: z.string().uuid("Invalid task."),
    blockedTaskId: z.string().uuid("Invalid task."),
  })
  .refine((data) => data.blockingTaskId !== data.blockedTaskId, {
    message: "A task cannot depend on itself.",
    path: ["blockedTaskId"],
  });

export type CreateDependencyInput = z.infer<typeof createDependencySchema>;

// F157 (AS-282): validates deleteDependency's input. A dependency is
// removed by its OWN row id, never by re-supplying the (blocking,
// blocked) pair — this is what makes removal symmetric ("either side of
// the relationship" can trigger it): the UI on either task's detail
// sheet already has the row's id from whichever query loaded it
// (getTaskDetail's `dependencies.blockedBy`/`dependencies.blocks`), so
// there is no "which side am I" branch for this schema, or the action
// that consumes it, to get wrong.
export const deleteDependencySchema = z.object({
  dependencyId: z.string().uuid("Invalid dependency."),
});

export type DeleteDependencyInput = z.infer<typeof deleteDependencySchema>;
