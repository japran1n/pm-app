"use server";
import { logger } from "@/lib/observability/logger";


// F254 (AS-494): "A brand-new workspace offers to create a sample project so
// the app is not empty on first login."
//
// This is a thin orchestrator, NOT a parallel write path: every row it
// creates goes through the exact same Server Actions a real user would call
// by hand (createProject, createTask, addChecklistItem, addComment). None of
// them are bypassed or duplicated here — this file owns no `.insert()` calls
// of its own, no admin-client usage, and no RLS/validation logic. That means
// the sample project gets every guarantee those actions already provide for
// free: Zod validation, membership + `canWrite` (viewers are read-only, per
// AS-216/AS-217) re-checked server-side, generic user-facing errors with
// details only logged server-side, and audit-log entries for the create
// paths that already write them (createProject/createTask do not — matching
// what a normal user's clicks would produce).
//
// "Clearly labelled as a sample and deletable in one step" (this feature's
// clarified spec): per the clarification's "simpler option, no new
// dependency" instruction, this does NOT add a new `is_sample` column to
// `projects` (a second, DB-level source of truth for something the name and
// description already say in plain English). The project's name and
// description say "sample" explicitly, and it is a completely ordinary
// project afterwards — deletable via the existing one-step Archive control
// every other project already has (components/archive-project-dialog.tsx
// via lib/actions/projects.ts's archiveProject), no bespoke "delete sample"
// affordance needed.
//
// Every default project gets the same four board columns
// (`project_statuses`: todo / in_progress / in_review / done) via the
// `projects_seed_default_statuses` DB trigger (F218,
// supabase/migrations/20260824010000_project_statuses.sql) regardless of
// which code path inserted the row — so `createTask`'s plain `status`
// strings below ("todo" / "in_progress" / "in_review" / "done") land in the
// SAME default columns any other newly created project already has, with no
// extra column-creation step needed here.

import { createProject } from "@/lib/actions/projects";
import { createTask } from "@/lib/actions/tasks";
import { addChecklistItem } from "@/lib/actions/checklist";
import { addComment } from "@/lib/actions/comments";

export type CreateSampleProjectResult =
  | {
      ok: true;
      data: {
        projectId: string;
        projectName: string;
        tasksCreated: number;
      };
    }
  | { ok: false; error: string };

function isoDateInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Real, specific copy — not lorem ipsum (per this feature's clarified
// spec's explicit note: "Sample content is the first impression of the
// product"). Modelled on a small website-launch project so every column,
// priority, and due date reads like something a real team would actually
// track.
const SAMPLE_TASKS: Array<{
  title: string;
  description: string;
  status: string;
  priority: "urgent" | "high" | "medium" | "low" | "backlog";
  dueInDays: number;
}> = [
  {
    title: "Draft the project brief",
    description:
      "Write up goals, scope, and success metrics so everyone starts from the same page.",
    status: "todo",
    priority: "medium",
    dueInDays: 3,
  },
  {
    title: "Collect stakeholder feedback",
    description: "Share the brief and gather sign-off before design work starts.",
    status: "todo",
    priority: "low",
    dueInDays: 6,
  },
  {
    title: "Design the landing page",
    description: "Mock up the hero section, pricing, and signup form for review.",
    status: "in_progress",
    priority: "high",
    dueInDays: 1,
  },
  {
    title: "Build the signup flow",
    description: "Wire up the form from the design, including validation and error states.",
    status: "in_review",
    priority: "urgent",
    dueInDays: 2,
  },
  {
    title: "Ship the announcement email",
    description: "Final copy is approved — send to the launch list.",
    status: "done",
    priority: "high",
    dueInDays: -1,
  },
];

// Creates one sample project (with its four default columns already seeded
// by the DB trigger), a handful of tasks spread across those columns with
// real priorities and due dates, a checklist on the first task, and a
// comment on that same task.
//
// Authorization: entirely delegated to `createProject` (membership +
// `canWrite` re-checked there) — this function performs no auth check of
// its own and no admin-client read/write. A caller without permission to
// create a project in this workspace gets exactly the same rejection
// `createProject` already returns to any other caller (AS-143 convention),
// and none of the subsequent task/checklist/comment actions are even
// attempted.
//
// Partial-failure handling: unlike `createProjectFromTemplate`'s single
// atomic RPC, this walks a loop of independent Server Action calls (the
// clarified spec requires reusing the NORMAL actions, which are not
// wrapped in one transaction). If the project itself is created but one
// task fails to insert (e.g. a transient DB error), that single task is
// skipped (logged, not thrown) and the loop continues — the caller still
// gets a real, usable sample project with whatever subset of tasks
// succeeded, rather than the whole offer failing because of one row. The
// project is always returned as the success signal once it exists; a
// fully-failed task loop still leaves an empty-but-real, clearly-labelled,
// one-step-deletable project behind rather than silently discarding it.
export async function createSampleProject(
  workspaceId: string,
): Promise<CreateSampleProjectResult> {
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, error: "Invalid workspace." };
  }

  const project = await createProject(
    workspaceId,
    "Sample Project",
    "A sample project — explore the board, priorities, due dates, a checklist, and a comment. Delete it any time from the project's Archive control.",
  );

  if (!project.ok) {
    return project;
  }

  let tasksCreated = 0;
  let firstTaskId: string | null = null;

  for (const task of SAMPLE_TASKS) {
    const created = await createTask(
      project.data.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      null,
      isoDateInDays(task.dueInDays),
    );

    if (!created.ok) {
      logger.error("createSampleProject: sample task creation failed (skipping this task)", { taskTitle: task.title, error: created.error });
      continue;
    }

    tasksCreated += 1;
    if (!firstTaskId) {
      firstTaskId = created.data.id;
    }

    // Checklist + comment go on the very first task only, per this
    // feature's spec ("a checklist" / "a comment" — singular, not on every
    // task).
    if (created.data.id === firstTaskId) {
      const checklistResult = await addChecklistItem(
        created.data.id,
        "Confirm the goals and scope with the team",
      );
      if (!checklistResult.ok) {
        logger.error("createSampleProject: sample checklist item failed (non-fatal)", { error: checklistResult.error });
      }

      const secondChecklistResult = await addChecklistItem(
        created.data.id,
        "List who needs to sign off",
      );
      if (!secondChecklistResult.ok) {
        logger.error("createSampleProject: sample checklist item failed (non-fatal)", { error: secondChecklistResult.error });
      }

      const commentResult = await addComment(
        created.data.id,
        "Welcome! This is a sample task — edit it, check things off, or delete the whole project whenever you're ready.",
      );
      if (!commentResult.ok) {
        logger.error("createSampleProject: sample comment failed (non-fatal)", { error: commentResult.error });
      }
    }
  }

  return {
    ok: true,
    data: {
      projectId: project.data.id,
      projectName: project.data.name,
      tasksCreated,
    },
  };
}
