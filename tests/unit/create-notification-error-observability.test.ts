// F304 (D2/FU-4 scrutiny fix): unit coverage for lib/notifications/
// create-notification.ts's createNotification — the core regression test
// for this fix. Before this fix, every fan-out call site (except
// lib/notifications/mentions.ts) called `supabase.rpc("create_notification",
// {...})` without destructuring the returned `error`; supabase-js
// *resolves* (never throws) on an RPC error, so a rejected RPC was
// silently dropped with zero observability. This proves the shared helper
// actually observes (logs) both an `error`-shaped RPC result and a thrown
// rejection, while still never throwing itself (non-fatal by design).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createNotification } from "@/lib/notifications/create-notification";

describe("F304 createNotification error observability", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("test_AS_386_regression_an_rpc_error_result_is_logged_not_silently_swallowed", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "recipient is not an active member", code: "P0001" },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createNotification(
      fakeSupabase,
      {
        userId: "user-1",
        workspaceId: "workspace-1",
        kind: "mention",
        taskId: "task-1",
      },
      "test_caller",
    );

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, context] = errorSpy.mock.calls[0];
    expect(String(message)).toContain("test_caller");
    expect(String(message)).toContain("create_notification");
    expect(context).toMatchObject({
      kind: "mention",
      userId: "user-1",
      taskId: "task-1",
    });
  });

  it("test_AS_386_regression_a_thrown_rpc_rejection_is_also_logged_and_never_propagates", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error("network error")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createNotification(
      fakeSupabase,
      {
        userId: "user-2",
        workspaceId: "workspace-1",
        kind: "task_assigned",
        taskId: "task-2",
      },
      "test_caller",
    );

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("test_a_successful_rpc_call_does_not_log_and_reports_ok", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createNotification(
      fakeSupabase,
      {
        userId: "user-3",
        workspaceId: "workspace-1",
        kind: "watcher_update",
        taskId: "task-3",
      },
      "test_caller",
    );

    expect(result.ok).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
