import { describe, expect, it } from "vitest";

import { countChecklistProgress } from "@/lib/tasks/checklist-progress";

// F153 (AS-269 UI half): unit coverage for the checklist progress bar's
// counting logic. This is a pure function (no React/DOM dependency), so
// it's genuinely testable in this repo's `environment: "node"` vitest
// config — unlike keyboard interaction, which needs a real browser (see
// tests/e2e/checklist-ui.spec.ts).
describe("countChecklistProgress (F153: AS-269 UI half)", () => {
  it("counts zero of zero for an empty checklist", () => {
    expect(countChecklistProgress([])).toEqual({ checked: 0, total: 0 });
  });

  it("counts a mix of checked and unchecked items", () => {
    const items = [
      { isChecked: true },
      { isChecked: false },
      { isChecked: true },
      { isChecked: false },
      { isChecked: false },
    ];
    expect(countChecklistProgress(items)).toEqual({ checked: 2, total: 5 });
  });

  it("counts all items checked", () => {
    const items = [{ isChecked: true }, { isChecked: true }];
    expect(countChecklistProgress(items)).toEqual({ checked: 2, total: 2 });
  });

  it("counts all items unchecked", () => {
    const items = [{ isChecked: false }, { isChecked: false }];
    expect(countChecklistProgress(items)).toEqual({ checked: 0, total: 2 });
  });

  it("does not mutate the input array", () => {
    const items = [{ isChecked: true }, { isChecked: false }];
    const snapshot = [...items];
    countChecklistProgress(items);
    expect(items).toEqual(snapshot);
  });
});
