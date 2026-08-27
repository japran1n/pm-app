// F5 (docs/advanced-chat-plan.md): unit tests for getWorkspaceChannels'
// unread_count computation -- messages with created_at strictly after the
// caller's channel_members.last_read_at count as unread, per channel,
// via one aggregate messages query (no N+1 per channel).

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

function makeMessagesQuery(messageRows: Row[]) {
  return {
    select: vi.fn(() => ({
      in: vi.fn(() => ({
        order: vi.fn(async () => ({ data: messageRows, error: null })),
      })),
    })),
  };
}

let memberRows: Row[];
let channelRows: Row[];
let messageRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "channel_members") return makeChannelMembersQuery(memberRows);
      if (table === "channels") return makeChannelsQuery(channelRows);
      if (table === "messages") return makeMessagesQuery(messageRows);
      throw new Error(`unexpected table ${table}`);
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
    memberRows = [
      { channel_id: "chan-1", last_read_at: "2026-08-27T10:00:00.000Z" },
    ];
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
    messageRows = [
      { channel_id: "chan-1", created_at: "2026-08-27T11:00:00.000Z" }, // after -> unread
      { channel_id: "chan-1", created_at: "2026-08-27T12:00:00.000Z" }, // after -> unread
      { channel_id: "chan-1", created_at: "2026-08-27T09:00:00.000Z" }, // before -> read
    ];

    const result = await getWorkspaceChannels("ws-1");

    expect(result).toHaveLength(1);
    expect(result[0].unreadCount).toBe(2);
  });

  it("test_AS_unread_count_is_zero_when_every_message_predates_last_read_at", async () => {
    memberRows = [
      { channel_id: "chan-1", last_read_at: "2026-08-27T23:00:00.000Z" },
    ];
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
    messageRows = [
      { channel_id: "chan-1", created_at: "2026-08-27T11:00:00.000Z" },
    ];

    const result = await getWorkspaceChannels("ws-1");

    expect(result[0].unreadCount).toBe(0);
  });

  it("test_AS_unread_count_is_computed_independently_per_channel", async () => {
    memberRows = [
      { channel_id: "chan-1", last_read_at: "2026-08-27T10:00:00.000Z" },
      { channel_id: "chan-2", last_read_at: "2026-08-27T10:00:00.000Z" },
    ];
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
    messageRows = [
      { channel_id: "chan-1", created_at: "2026-08-27T11:00:00.000Z" },
      { channel_id: "chan-2", created_at: "2026-08-27T09:00:00.000Z" },
    ];

    const result = await getWorkspaceChannels("ws-1");
    const byId = new Map(result.map((r) => [r.id, r.unreadCount]));

    expect(byId.get("chan-1")).toBe(1);
    expect(byId.get("chan-2")).toBe(0);
  });
});
