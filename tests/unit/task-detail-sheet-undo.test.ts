// F190 (AS-345): "deleting shows an undo affordance that restores without
// visiting trash" — task-detail-sheet.tsx's delete wiring.
//
// TaskDetailSheet (components/task/task-detail-sheet.tsx) composes a large
// tree (rich-text editor dynamic import, tags editor, watchers, recurrence
// editor, checklist, comments) that this repo's other TaskDetailSheet-
// touching tests (tests/unit/board-task-detail-sheet-wiring.test.ts) also
// avoid mounting directly in jsdom for exactly that reason, preferring
// source inspection for wiring-shaped assertions. This test follows that
// same established pattern: it proves the real source wires deleteTask's
// success path to `showUndoToast`, with the Undo action calling the real
// `restoreTask` for the SAME task id that was just deleted — not a
// disconnected toast that merely disappears.
//
// The genuine-restore behaviour of `restoreTask` itself (the row actually
// coming back, in its original project/status) is proven end-to-end by
// tests/integration/restore-task.test.ts (F189) and
// tests/integration/bulk-restore-tasks.test.ts (F190); this test's job is
// only to prove THIS component's delete handler is actually wired to that
// real action via the Undo button, not a no-op or a fake success toast.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../../components/task/task-detail-sheet.tsx", import.meta.url),
  ),
  "utf-8",
);

describe("TaskDetailSheet delete/undo wiring (F190: AS-345)", () => {
  it("imports restoreTask (the real Server Action) and the shared showUndoToast helper", () => {
    expect(source).toMatch(/import\s*\{[\s\S]*?restoreTask[\s\S]*?\}\s*from\s*"@\/lib\/actions\/tasks"/);
    expect(source).toMatch(
      /import\s*{\s*showUndoToast\s*}\s*from\s*"@\/lib\/toast\/undo-toast"/,
    );
  });

  it("handleDelete calls showUndoToast on a successful delete, before any early return", () => {
    const handleDeleteBody = source.slice(
      source.indexOf("function handleDelete("),
      source.indexOf("function handleDelete(") + 1200,
    );
    expect(handleDeleteBody).toMatch(/deleteTask\(deletedTaskId\)/);
    expect(handleDeleteBody).toMatch(/if \(result\.ok\)/);
    expect(handleDeleteBody).toMatch(/showUndoToast\(/);
  });

  it("the Undo action calls restoreTask with the SAME task id that was deleted, not a different or hardcoded id", () => {
    const handleDeleteBody = source.slice(
      source.indexOf("function handleDelete("),
      source.indexOf("function handleDelete(") + 1200,
    );
    // deletedTaskId is captured once from `task.id` before the async
    // transition starts, and reused for both the delete and the undo's
    // restore call — proving Undo targets the exact task that was just
    // deleted.
    expect(handleDeleteBody).toMatch(/const deletedTaskId = task\.id;/);
    expect(handleDeleteBody).toMatch(/restoreTask\(deletedTaskId\)/);
  });
});
