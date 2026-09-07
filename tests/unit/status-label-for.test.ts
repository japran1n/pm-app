// Krug 2 UX audit fix: shared lookup behind the My Tasks / project List
// status-column parity fix (lib/task-colors.ts's statusLabelFor). Both
// app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx and .../projects/
// [projectId]/list/page.tsx now build their per-project statusOptions
// through this single function instead of each re-implementing (or, in My
// Tasks' case, omitting) the STATUS_LABELS fallback -- see this test's
// sibling tests/unit/my-task-row-parity.test.tsx for the DOM-level proof.

import { describe, expect, it } from "vitest";

import { statusLabelFor } from "@/lib/task-colors";

describe("test_status_label_for_formats_known_status_values", () => {
  it("formats each of the fixed four legacy status values", () => {
    expect(statusLabelFor("todo")).toBe("To Do");
    expect(statusLabelFor("in_progress")).toBe("In Progress");
    expect(statusLabelFor("in_review")).toBe("In Review");
    expect(statusLabelFor("done")).toBe("Done");
  });

  it("falls back to the raw value verbatim for a project's custom column name", () => {
    // F221/F223: a project can rename a column to anything -- there is no
    // formatted label to look up, so the real (already human-authored)
    // name passes through unchanged.
    expect(statusLabelFor("Blocked on Client")).toBe("Blocked on Client");
  });
});
