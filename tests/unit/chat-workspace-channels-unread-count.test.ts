// F5/W3 (docs/advanced-chat-plan.md): unit tests for getWorkspaceChannels'
// unread_count and lastMessageAt computation -- both are now sourced from a
// single `get_chat_channel_summaries` RPC round-trip (W3 fix for two
// provably-wrong client-side queries: an unfiltered "since epoch" unread
// query, and a globally-ordered "top N*2 messages" latest-message query that
// could starve every channel except the busiest one).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

function makeChannelMembersQuery(memberRows: Row[]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({ data: memberRows, error: null })),
    })),
  };
}

function makeChannelsQuery(channelRows: Row[]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(async () => ({ data: channelRows, error: null })),
      })),
    })),
  };
}

let memberRows: Row[];
let channelRows: Row[];
let summaryRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "channel_members") return makeChannelMembersQuery(memberRows);
      if (table === "channels") return makeChannelsQuery(channelRows);
      throw new Error(`unexpected table ${table}`);
    }),
    rpc: vi.fn(async (fnName: string) => {
      if (fnName === "get_chat_channel_summaries") {
        return { data: summaryRows, error: null };
      }
      throw new Error(`unexpected rpc ${fnName}`);
    }),
  })),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async () => new Map()),
}));

import { getWorkspaceChannels } from "@/lib/queries/chat";

describe("getWorkspaceChannels unread_count (F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test_AS_unread_count_counts_only_messages_after_the_caller_last_read_at", async () => {
    memberRows = [{ channel_id: "chan-1" }];
    channelRows = [
      {
        id: "chan-1",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "general",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ];
    // The RPC itself is responsible for comparing message created_at against
    // channel_members.last_read_at server-side; this test asserts the query
    // layer correctly surfaces whatever the RPC returns.
    summaryRows = [
      {
        channel_id: "chan-1",
        last_message_at: "2026-08-27T12:00:00.000Z",
        unread_count: 2,
      },
    ];

    const result = await getWorkspaceChannels("ws-1");

    expect(result).toHaveLength(1);
    expect(result[0].unreadCount).toBe(2);
  });

  it("test_AS_unread_count_is_zero_when_every_message_predates_last_read_at", async () => {
    memberRows = [{ channel_id: "chan-1" }];
    channelRows = [
      {
        id: "chan-1",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "general",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ];
    summaryRows = [
      {
        channel_id: "chan-1",
        last_message_at: "2026-08-27T11:00:00.000Z",
        unread_count: 0,
      },
    ];

    const result = await getWorkspaceChannels("ws-1");

    expect(result[0].unreadCount).toBe(0);
  });

  it("test_AS_unread_count_is_computed_independently_per_channel", async () => {
    memberRows = [{ channel_id: "chan-1" }, { channel_id: "chan-2" }];
    channelRows = [
      {
        id: "chan-1",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "general",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "chan-2",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "random",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ];
    summaryRows = [
      { channel_id: "chan-1", last_message_at: "2026-08-27T11:00:00.000Z", unread_count: 1 },
      { channel_id: "chan-2", last_message_at: "2026-08-27T09:00:00.000Z", unread_count: 0 },
    ];

    const result = await getWorkspaceChannels("ws-1");
    const byId = new Map(result.map((r) => [r.id, r.unreadCount]));

    expect(byId.get("chan-1")).toBe(1);
    expect(byId.get("chan-2")).toBe(0);
  });

  it("test_AS_last_message_at_is_reported_per_channel_even_when_one_channel_owns_the_most_recent_messages", async () => {
    // Bug 2 regression: a globally-ordered "top N*2 rows" query would let a
    // single busy channel (chan-busy) own every row in the result set,
    // starving chan-quiet-1/2/3 of a lastMessageAt entirely. The RPC (DISTINCT
    // ON per channel_id) must report every channel's own most recent message
    // regardless of how many messages other channels have.
    memberRows = [
      { channel_id: "chan-busy" },
      { channel_id: "chan-quiet-1" },
      { channel_id: "chan-quiet-2" },
      { channel_id: "chan-quiet-3" },
    ];
    channelRows = [
      {
        id: "chan-busy",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "busy",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "chan-quiet-1",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "quiet-1",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "chan-quiet-2",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "quiet-2",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "chan-quiet-3",
        workspace_id: "ws-1",
        project_id: null,
        kind: "channel",
        name: "quiet-3",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ];
    // chan-busy owns the most recent message in the whole workspace, but
    // every quiet channel still has its own (older, but real) last message.
    summaryRows = [
      { channel_id: "chan-busy", last_message_at: "2026-08-27T23:59:00.000Z", unread_count: 0 },
      { channel_id: "chan-quiet-1", last_message_at: "2026-08-20T10:00:00.000Z", unread_count: 0 },
      { channel_id: "chan-quiet-2", last_message_at: "2026-08-19T10:00:00.000Z", unread_count: 0 },
      { channel_id: "chan-quiet-3", last_message_at: "2026-08-18T10:00:00.000Z", unread_count: 0 },
    ];

    const result = await getWorkspaceChannels("ws-1");
    const byId = new Map(result.map((r) => [r.id, r.lastMessageAt]));

    expect(byId.get("chan-busy")).toBe("2026-08-27T23:59:00.000Z");
    expect(byId.get("chan-quiet-1")).toBe("2026-08-20T10:00:00.000Z");
    expect(byId.get("chan-quiet-2")).toBe("2026-08-19T10:00:00.000Z");
    expect(byId.get("chan-quiet-3")).toBe("2026-08-18T10:00:00.000Z");

    // Sidebar activity ordering: most-recently-active channel first.
    expect(result.map((r) => r.id)).toEqual([
      "chan-busy",
      "chan-quiet-1",
      "chan-quiet-2",
      "chan-quiet-3",
    ]);
  });
});
