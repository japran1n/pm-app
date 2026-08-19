// F154 (AS-272, AS-273): single source of truth for a task's overall
// "completion percentage" — the number shown on the board/list card.
//
// Per the Clarified implementation (Data shape/API answers): a pure,
// side-effect-free function over plain typed counts, never raw database
// rows or React state. It does NOT fetch or count anything itself — the
// caller (lib/queries/tasks.ts's getProjectBoardTasks) already computes
// checklist and child-task counts via lib/tasks/checklist-progress.ts's
// countChecklistProgress and lib/tasks/subtask-progress.ts's
// countSubtaskProgress (both pre-existing from F153/F150), and this
// function just combines those two already-counted totals into one
// percentage. This keeps the "done" convention (a child task's status
// equals the fixed string "done") living in exactly one place —
// countSubtaskProgress — rather than being re-implemented or re-compared
// here; when custom statuses arrive in M16, F222 only has to change that
// one function, not this one.
//
// Weighting (Clarified implementation's ambiguity-resolution answer,
// recorded per this feature's own "Notes for clarification"): checklist
// items and child tasks are flat, equal units. A task with 1 of 2
// checklist items checked and 1 of 2 children done is 50% complete
// (2 of 4), identical to a task with 2 of 4 checklist items checked and
// no children at all — there is no separate weighting between the two
// kinds of unit. This is the simpler option that adds no new dependency
// and no second source of truth (a weighted average would need a policy
// decision this spec never asked for).
//
// AS-273's "no percentage at all, not 0%" contract: when there is
// nothing to measure (checklistTotal + childTotal === 0), this returns
// `null`, never a TaskCompletion with percent 0. A task with a checklist/
// children where NOTHING is done yet legitimately returns percent: 0 (a
// real "0 of N done" measurement) — the distinction AS-273 draws is
// "there is no measurement" vs. "the measurement is zero", not "done
// count is zero".

export type TaskCompletionInput = {
  checklistTotal: number;
  checklistDone: number;
  childTotal: number;
  childDone: number;
};

export type TaskCompletion = {
  done: number;
  total: number;
  /** Rounded to the nearest whole percent, 0-100. */
  percent: number;
};

export function computeTaskCompletion(
  input: TaskCompletionInput,
): TaskCompletion | null {
  const total = input.checklistTotal + input.childTotal;
  if (total <= 0) {
    // AS-273: nothing to measure — explicit "none" result, never a
    // misleading 0%.
    return null;
  }

  const done = input.checklistDone + input.childDone;
  const percent = Math.round((done / total) * 100);

  return { done, total, percent };
}
