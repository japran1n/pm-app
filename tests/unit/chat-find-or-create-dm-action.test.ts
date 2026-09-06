// Unit tests for lib/actions/chat-channels.ts's findOrCreateDirectMessage
// Server Action. Mirrors tests/unit/chat-send-message-action.test.ts's
// mocked-client pattern: unauthenticated rejection, invalid-input
// rejection, and the action's own membership re-checks -- the real
// find-or-create/uniqueness/RLS enforcement is covered separately by
// tests/integration/dm-find-or-create-rls.test.ts against a live DB.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";

function makeSupabaseMock(opts: {
  user: { id: string } | null;
  membershipByUserId: Record<string, { role: string } | null>;
  rpcError?: { message: string } | null;
  rpcResult?: string | null;
}) {
  // requireActiveMembership does: .from("workspace_members").select("role")
  // .eq("workspace_id", ...).eq("user_id", ...).eq("status", "active")
  // .maybeSingle() -- the mock only needs to remember which user_id the
  // second .eq() was called with to resolve the right membership row.
  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    from: (table: string) => {
      if (table !== "workspace_members") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: (_col: string, userId: string) => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.membershipByUserId[userId] ?? null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    },
    rpc: async (name: string) => {
      if (name !== "find_or_create_dm_channel_atomic") {
        throw new Error(`unexpected rpc: ${name}`);
      }
      return {
        data: opts.rpcError ? null : (opts.rpcResult ?? CHANNEL_ID),
        error: opts.rpcError ?? null,
      };
    },
  };

  return client;
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockSupabase,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

describe("findOrCreateDirectMessage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("test_DM_rejects_an_unauthenticated_caller", async () => {
    mockSupabase = makeSupabaseMock({
      user: null,
      membershipByUserId: {},
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, OTHER_USER_ID);
    expect(result.ok).toBe(false);
  });

  it("test_DM_rejects_an_invalid_other_user_id", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      membershipByUserId: { [USER_ID]: { role: "member" } },
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, "not-a-uuid");
    expect(result.ok).toBe(false);
  });

  it("test_DM_rejects_starting_a_direct_message_with_yourself", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      membershipByUserId: { [USER_ID]: { role: "member" } },
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/yourself/i);
    }
  });

  it("test_DM_rejects_when_caller_is_not_an_active_workspace_member", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      membershipByUserId: { [USER_ID]: null, [OTHER_USER_ID]: { role: "member" } },
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, OTHER_USER_ID);
    expect(result.ok).toBe(false);
  });

  it("test_DM_rejects_when_target_user_is_not_an_active_workspace_member", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      membershipByUserId: { [USER_ID]: { role: "member" }, [OTHER_USER_ID]: null },
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, OTHER_USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/member/i);
    }
  });

  it("test_DM_succeeds_and_returns_the_rpc_channel_id_for_two_active_members", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      membershipByUserId: { [USER_ID]: { role: "member" }, [OTHER_USER_ID]: { role: "member" } },
      rpcResult: CHANNEL_ID,
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, OTHER_USER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(CHANNEL_ID);
    }
  });

  it("test_DM_surfaces_a_generic_error_when_the_rpc_fails", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      membershipByUserId: { [USER_ID]: { role: "member" }, [OTHER_USER_ID]: { role: "member" } },
      rpcError: { message: "boom" },
    });
    const { findOrCreateDirectMessage } = await import("@/lib/actions/chat-channels");

    const result = await findOrCreateDirectMessage(WORKSPACE_ID, OTHER_USER_ID);
    expect(result.ok).toBe(false);
  });
});
