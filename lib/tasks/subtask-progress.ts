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
// "Done" here means the task's `status` column equals the fixed value
// "done" — the same convention every other status check in this codebase
// uses today (e.g. lib/tasks/is-overdue.ts's own status check). Custom
// statuses arrive in M16 (F218-F222); per this feature's worker brief,
// F222 is expected to sweep this exact check and replace it with a lookup
// against the workspace's configured "done" status/statuses once that
// concept exists. Kept as one small function specifically so that future
// change only has to happen in one place, not in every component that
// currently renders a completion count.

export type SubtaskProgressInput = {
  status: string;
};

export type SubtaskProgress = {
  done: number;
  total: number;
};

export function countSubtaskProgress(
  children: SubtaskProgressInput[],
): SubtaskProgress {
  return {
    done: children.filter((child) => child.status === "done").length,
    total: children.length,
  };
}
