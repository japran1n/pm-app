// F153 (AS-269 UI half): single source of truth for "how many of this
// task's checklist items are checked", used by components/task/
// checklist.tsx's progress bar. Extracted as a pure function (no React
// dependency) so the counting behaviour is unit-testable without a
// browser/DOM — this repo's vitest config runs in the "node" environment
// (vitest.config.ts) and has no jsdom/@testing-library yet (that arrives
// in F277) — mirroring lib/tasks/subtask-progress.ts's own identical
// "pure-function single source of truth" rationale (and deliberately
// named/shaped the same way, rather than reusing that file directly,
// since a checklist item's "done" field is `isChecked`, not a `status`
// string — the two progress concepts are structurally different even
// though the counting logic looks similar).
//
// This is NOT the task-level completion percentage across checklist AND
// subtasks together (that's AS-272/AS-273, explicitly out of scope here
// per this feature's own brief — F154's job). This only ever counts a
// single task's own checklist items.

export type ChecklistProgressInput = {
  isChecked: boolean;
};

export type ChecklistProgress = {
  checked: number;
  total: number;
};

export function countChecklistProgress(
  items: ChecklistProgressInput[],
): ChecklistProgress {
  return {
    checked: items.filter((item) => item.isChecked).length,
    total: items.length,
  };
}
