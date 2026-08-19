// Unit tests for F146 (AS-258): lib/tasks/task-key.ts's formatTaskKey, the
// single formatter every task-identity surface (task card, task detail
// header, list row/dashboard table, search result) calls instead of
// re-concatenating a project key and task number locally.
//
// Per this feature's clarification (Round B Q2, "take the simpler option
// ... record the choice") and the worker brief's explicit instruction
// ("write a unit test for the formatter, including the missing-key/
// missing-number edge case"), this file is the primary, required piece of
// evidence for AS-258 — see the handoff's "Assertions covered" and "Notes
// for the next worker" for what else is (and isn't) covered beyond this.

import { describe, expect, it } from "vitest";

import { formatTaskKey } from "@/lib/tasks/task-key";

describe("formatTaskKey (F146, AS-258)", () => {
  it("test_AS_258_combines_a_project_key_and_task_number_into_KEY_DASH_NUMBER", () => {
    expect(formatTaskKey("PM", 142)).toBe("PM-142");
  });

  it("test_AS_258_works_for_the_first_task_in_a_project_number_1", () => {
    expect(formatTaskKey("ENG", 1)).toBe("ENG-1");
  });

  it("test_AS_258_preserves_the_projects_exact_key_casing_and_characters", () => {
    // projects.key is stored uppercase per F145's format constraint
    // (^[A-Z][A-Z0-9]{1,5}$), but this formatter doesn't itself enforce
    // or reshape casing — it just concatenates whatever it's given.
    expect(formatTaskKey("FOPM", 7)).toBe("FOPM-7");
  });

  it("test_AS_258_a_projects_key_change_is_reflected_immediately_not_frozen_at_creation", () => {
    // The feature spec's one open question, resolved in the handoff's
    // Decisions Made: the displayed key follows the project's CURRENT
    // key, never one snapshotted at task creation. This formatter takes
    // the key as a plain argument (not from a stored per-task column), so
    // the exact same task number formatted against an "old" vs. "new"
    // project key produces two different, both-correct strings — there
    // is no cached/stale copy anywhere for this function to disagree
    // with itself about.
    const taskNumber = 142;
    const keyBeforeRename = formatTaskKey("PM", taskNumber);
    const keyAfterRename = formatTaskKey("PLAT", taskNumber);

    expect(keyBeforeRename).toBe("PM-142");
    expect(keyAfterRename).toBe("PLAT-142");
    expect(keyAfterRename).not.toBe(keyBeforeRename);
  });

  it("test_AS_258_negative_missing_project_key_returns_null_not_a_malformed_string", () => {
    expect(formatTaskKey(null, 142)).toBeNull();
    expect(formatTaskKey(undefined, 142)).toBeNull();
    expect(formatTaskKey("", 142)).toBeNull();
  });

  it("test_AS_258_negative_missing_task_number_returns_null_not_a_malformed_string", () => {
    expect(formatTaskKey("PM", null)).toBeNull();
    expect(formatTaskKey("PM", undefined)).toBeNull();
  });

  it("test_AS_258_negative_a_zero_or_negative_task_number_returns_null", () => {
    // 0/negative should never occur for a real row (F145's
    // tasks_number_positive CHECK constraint), but this formatter is the
    // last line of defense against ever rendering "PM-0" for a task whose
    // number assignment hasn't landed yet (e.g. a stale/partial client
    // object) — treated the same as "missing", not as a valid identifier.
    expect(formatTaskKey("PM", 0)).toBeNull();
    expect(formatTaskKey("PM", -1)).toBeNull();
  });

  it("test_AS_258_negative_both_missing_returns_null", () => {
    expect(formatTaskKey(null, null)).toBeNull();
    expect(formatTaskKey(undefined, undefined)).toBeNull();
  });
});
