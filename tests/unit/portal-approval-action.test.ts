// F020 fix-up (scrutiny-2.md Part 2, BLOCKER-2): server-side coverage for
// lib/actions/portal-approval.ts, which had none. Both `approvePortalTask`
// and `requestPortalTaskChanges` sit in front of a SECURITY DEFINER RPC
// (`approve_portal_task_atomic` / `request_portal_task_changes_atomic`,
// 20260905130000 + 20260906010000) with no other authorization layer, so
// every gate here must be independently discriminating: deleting any one
// of them must fail a test.
//
// Mirrors tests/unit/chat-send-message-action.test.ts's mocked-client
// pattern. `addComment` is mocked directly rather than driving its own
// query chain -- this file owns the permission gate + RPC call, not the
// comment write, which is already covered elsewhere.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";

type TaskRow = {
  id: string;
  client_visible: boolean;
  pending_client_approval: boolean;
  projects: { workspace_id: string } | null;
} | null;

type MockOpts = {
  user: { id: string } | null;
  taskRow: TaskRow;
  taskLookupError?: boolean;
  membership: { ok: true; role: string } | { ok: false };
  rpcError?: { message: string } | null;
  addCommentOk?: boolean;
};

let opts: MockOpts;
let rpcCalls: { name: string; args: unknown }[];
let commentCalls: { taskId: string; message: string }[];

function makeAdminClient() {
  return {
    from: (table: string) => {
      if (table === "tasks") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: opts.taskLookupError ? null : opts.taskRow,
                  error: opts.taskLookupError ? { message: "boom" } : null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "workspace_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () =>
                    opts.membership.ok
                      ? { data: { role: opts.membership.role }, error: null }
                      : { data: null, error: null },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
  };
}

function makeRlsClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return {
        data: opts.rpcError ? null : [{ task_id: TASK_ID }],
        error: opts.rpcError ?? null,
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeRlsClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/actions/comments", () => ({
  addComment: async (taskId: string, message: string) => {
    commentCalls.push({ taskId, message });
    return {
      ok: opts.addCommentOk ?? true,
      data: opts.addCommentOk === false ? undefined : { id: "c1" },
      error: opts.addCommentOk === false ? "comment failed" : undefined,
    };
  },
}));

function sharedPendingTask(): TaskRow {
  return {
    id: TASK_ID,
    client_visible: true,
    pending_client_approval: true,
    projects: { workspace_id: WORKSPACE_ID },
  };
}

function defaultOpts(): MockOpts {
  return {
    user: { id: USER_ID },
    taskRow: sharedPendingTask(),
    membership: { ok: true, role: "client" },
    rpcError: null,
    addCommentOk: true,
  };
}

describe("approvePortalTask / requestPortalTaskChanges (F020)", () => {
  beforeEach(() => {
    vi.resetModules();
    rpcCalls = [];
    commentCalls = [];
    opts = defaultOpts();
  });

  // --- shared gate coverage, exercised through approvePortalTask ---

  it("test_AS_013_014_invalid_uuid_is_rejected_without_calling_the_rpc", async () => {
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask("not-a-uuid");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_task_not_found_is_rejected", async () => {
    opts.taskRow = null;
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_task_not_client_visible_is_rejected", async () => {
    opts.taskRow = { ...sharedPendingTask()!, client_visible: false };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_task_not_pending_is_rejected", async () => {
    opts.taskRow = { ...sharedPendingTask()!, pending_client_approval: false };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_caller_not_signed_in_is_rejected", async () => {
    opts.user = null;
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_caller_not_an_active_member_is_rejected", async () => {
    opts.membership = { ok: false };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_caller_not_client_role_is_rejected", async () => {
    opts.membership = { ok: true, role: "member" };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_013_014_rpc_error_surfaces_as_a_failure_not_a_silent_success", async () => {
    opts.rpcError = { message: "denied" };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
  });

  // F009d (item FN): a generic RPC failure still collapses to the generic
  // message ...
  it("test_F009D_generic_rpc_error_still_collapses_to_the_generic_message", async () => {
    opts.rpcError = { message: "task not found" };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Something went wrong. Please try again in a moment.");
    }
  });

  // ... but the one RPC error that names "no decision owner configured"
  // (assert_portal_task_actionable_by_client, 20261021010000) is forwarded
  // as an honest, specific message instead -- matching the wording
  // approval-card.tsx already shows for the identical situation on the
  // Approvals view, so a client sees the same sentence on both surfaces.
  it("test_F009D_no_decision_owner_rpc_error_is_forwarded_with_the_approvals_view_wording", async () => {
    opts.rpcError = {
      message: "assert_portal_task_actionable_by_client: no one is assigned to decide this yet",
    };
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("No one is assigned to decide this yet.");
    }
  });

  it("test_F009D_request_changes_no_decision_owner_rpc_error_is_forwarded", async () => {
    opts.rpcError = {
      message: "assert_portal_task_actionable_by_client: no one is assigned to decide this yet",
    };
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("No one is assigned to decide this yet.");
    }
  });

  it("test_AS_013_014_happy_path_calls_approve_rpc_with_the_parsed_task_id", async () => {
    const { approvePortalTask } = await import("@/lib/actions/portal-approval");
    const result = await approvePortalTask(TASK_ID);
    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      { name: "approve_portal_task_atomic", args: { p_task_id: TASK_ID } },
    ]);
  });

  // --- request-changes: same gates, plus its own message validation ---

  it("test_AS_016_request_changes_rejects_an_empty_message", async () => {
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "   ");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_rejects_invalid_uuid", async () => {
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges("not-a-uuid", "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_task_not_found_is_rejected", async () => {
    opts.taskRow = null;
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_task_not_client_visible_is_rejected", async () => {
    opts.taskRow = { ...sharedPendingTask()!, client_visible: false };
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_task_not_pending_is_rejected", async () => {
    opts.taskRow = { ...sharedPendingTask()!, pending_client_approval: false };
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_caller_not_signed_in_is_rejected", async () => {
    opts.user = null;
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_caller_not_an_active_member_is_rejected", async () => {
    opts.membership = { ok: false };
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_caller_not_client_role_is_rejected", async () => {
    opts.membership = { ok: true, role: "admin" };
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_rpc_error_is_treated_as_a_failure_not_a_silent_success", async () => {
    // BLOCKER-3 regression: before the RPC, a zero-row RLS-respecting
    // update returned no error and the action returned { ok: true } even
    // though nothing changed. This pins that an RPC failure is now
    // surfaced.
    opts.rpcError = { message: "denied" };
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
  });

  it("test_AS_016_request_changes_happy_path_calls_the_request_changes_rpc_with_the_parsed_task_id", async () => {
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        name: "request_portal_task_changes_atomic",
        args: { p_task_id: TASK_ID },
      },
    ]);
  });

  it("test_AS_016_request_changes_surfaces_failure_when_the_trail_comment_fails", async () => {
    opts.addCommentOk = false;
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(result.ok).toBe(false);
  });

  // FU-R (scrutiny-3.md MAJOR-3): when the trail comment fails, the task
  // must stay retryable -- the flag must NOT have been flipped, so a
  // second attempt with the same message can still succeed instead of
  // permanently raising "task not found".
  it("test_AS_016_request_changes_comment_failure_leaves_the_task_pending_and_retryable", async () => {
    opts.addCommentOk = false;
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");

    expect(result.ok).toBe(false);
    // The comment was attempted with the client's real message -- it was
    // not silently discarded before being written.
    expect(commentCalls).toEqual([
      { taskId: TASK_ID, message: "Requested changes: please fix this" },
    ]);
    // Crucially, the RPC that flips `pending_client_approval` to false was
    // never called, so the task is left exactly as pending as it was
    // before the click -- a retry re-enters the same code path instead of
    // failing the RPC's `v_pending` check with a generic "task not found".
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_016_request_changes_posts_the_comment_before_flipping_the_pending_flag", async () => {
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const result = await requestPortalTaskChanges(TASK_ID, "please fix this");

    expect(result.ok).toBe(true);
    expect(commentCalls).toEqual([
      { taskId: TASK_ID, message: "Requested changes: please fix this" },
    ]);
    expect(rpcCalls).toEqual([
      {
        name: "request_portal_task_changes_atomic",
        args: { p_task_id: TASK_ID },
      },
    ]);
  });

  it("test_AS_016_request_changes_retry_after_a_comment_failure_succeeds_with_the_same_message", async () => {
    opts.addCommentOk = false;
    const { requestPortalTaskChanges } = await import("@/lib/actions/portal-approval");
    const first = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(first.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);

    // Simulate the transient failure clearing and the client retrying with
    // the same message -- the task is still pending (never flipped above),
    // so the RPC's `v_pending` gate still lets this through.
    opts.addCommentOk = true;
    const second = await requestPortalTaskChanges(TASK_ID, "please fix this");
    expect(second.ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        name: "request_portal_task_changes_atomic",
        args: { p_task_id: TASK_ID },
      },
    ]);
  });
});
