// F150 (AS-264): single source of truth for "how many of a parent task's
// children are done", used by the task-detail Subtasks section (the
// "3 of 5 done" count next to the Subtasks label). Extracted as a pure
// function (no React dependency) so AS-264's counting behaviour is
// unit-testable without a browser/DOM — this repo's vitest config runs in
// the "node" environment (vitest.config.ts) and has no jsdom/
// @testing-library yet (that arrives in F277) — mirroring
// lib/tasks/append-attachment.ts's and lib/task-colors.ts's own
// "pure-function single source of truth" rationale.
//
// F222 (AS-410): "done" here means the child task's column CATEGORY is
// `done` — resolved through the shared `isDoneStatus` helper
// (lib/tasks/status-category.ts), the one place this comparison lives.
// `statusCategory` is optional per-child: a caller that has already
// joined `project_statuses` (directly or via `status_id`) passes it and
// gets category-aware behaviour; a caller that hasn't yet falls back to
// `isDoneStatus`'s own literal-`status`-text rule (its `status_id is
// null` edge case), same as before this feature. Kept as one small
// function specifically so any future "what counts as done" change only
// has to happen in `status-category.ts`, not in every component that
// currently renders a completion count.

import { isDoneStatus } from "@/lib/tasks/status-category";

export type SubtaskProgressInput = {
  status: string;
  statusCategory?: string | null;
};

export type SubtaskProgress = {
  done: number;
  total: number;
};

export function countSubtaskProgress(
  children: SubtaskProgressInput[],
): SubtaskProgress {
  return {
    done: children.filter((child) =>
      isDoneStatus(child.status, child.statusCategory),
    ).length,
    total: children.length,
  };
}
