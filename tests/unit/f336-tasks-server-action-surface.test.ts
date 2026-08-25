// F336 (identical class of bug to M17 scrutiny BLOCKER-3/F334, security):
// every exported async function in a "use server" module is registered as
// a client-invocable Server Action endpoint, reachable by ID regardless of
// whether any UI calls it. lib/actions/tasks.ts used to export
// `createTaskForUser`, which trusted a caller-supplied `userId` as
// already-verified identity — any caller who could reach that action
// endpoint could create tasks (and trigger notification fan-out) as an
// arbitrary user. This test asserts the vulnerable function is absent from
// that module's export surface, so a future convenience re-export of a
// raw-userId-taking function can't silently reopen that hole.
//
// Unlike F334's attachments test, this does NOT assert a full closed set
// of exports: lib/actions/tasks.ts legitimately exports many other real
// Server Actions (editTask, moveTaskStatus, assignTask, duplicateTask,
// etc.) — a closed-set match here would make this test brittle against
// unrelated, legitimate feature work. Only the specific vulnerable shape
// is asserted absent.
import { describe, expect, it } from "vitest";

import * as tasksActions from "@/lib/actions/tasks";
import { createTaskForUser } from "@/lib/tasks/create";

describe("F336: lib/actions/tasks.ts export surface", () => {
  it("does not export createTaskForUser (a function taking a raw, trusted userId parameter)", () => {
    expect(
      (tasksActions as Record<string, unknown>).createTaskForUser,
    ).toBeUndefined();
  });

  it("createTask remains a legitimate exported Server Action", () => {
    expect(typeof (tasksActions as Record<string, unknown>).createTask).toBe(
      "function",
    );
  });

  it("the shared create-task implementation lives in a plain (non-Server-Action) module and is only reachable via direct import", () => {
    // Sanity check that the extraction target actually exists and is a
    // real function — this is the module the Route Handler and tests
    // import from directly instead of going through the Server Action
    // layer.
    expect(typeof createTaskForUser).toBe("function");
  });
});
