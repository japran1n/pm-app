// Read receipts: unit tests for computeLastMessageSeenBy -- the pure logic
// that decides which members show up in the "Seen by" avatar strip under
// the channel's last message.

import { describe, expect, it } from "vitest";

import { computeLastMessageSeenBy } from "@/lib/chat/read-receipts";

type ChatChannelMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

const alice: ChatChannelMember = {
  userId: "alice",
  name: "Alice",
  email: "alice@example.com",
  avatarUrl: null,
};
const bob: ChatChannelMember = {
  userId: "bob",
  name: "Bob",
  email: "bob@example.com",
  avatarUrl: null,
};
const carol: ChatChannelMember = {
  userId: "carol",
  name: "Carol",
  email: "carol@example.com",
  avatarUrl: null,
};

const lastMessage = { senderId: "alice", createdAt: "2026-09-07T12:00:00.000Z" };

describe("computeLastMessageSeenBy", () => {
  it("test_seen_by_includes_a_member_whose_last_read_at_is_at_or_after_the_message", () => {
    const result = computeLastMessageSeenBy(
      [alice, bob, carol],
      { bob: "2026-09-07T12:00:00.000Z", carol: "2026-09-07T13:00:00.000Z" },
      "alice",
      lastMessage,
    );
    expect(result.map((m) => m.userId).sort()).toEqual(["bob", "carol"]);
  });

  it("test_seen_by_excludes_a_member_whose_last_read_at_is_before_the_message", () => {
    const result = computeLastMessageSeenBy(
      [alice, bob],
      { bob: "2026-09-07T11:00:00.000Z" },
      "alice",
      lastMessage,
    );
    expect(result).toEqual([]);
  });

  it("test_seen_by_excludes_the_message_sender", () => {
    const result = computeLastMessageSeenBy(
      [alice, bob],
      { alice: "2026-09-07T13:00:00.000Z", bob: "2026-09-07T13:00:00.000Z" },
      "bob",
      lastMessage,
    );
    expect(result.map((m) => m.userId)).toEqual([]);
  });

  it("test_seen_by_excludes_the_current_user", () => {
    const result = computeLastMessageSeenBy(
      [alice, bob, carol],
      { bob: "2026-09-07T13:00:00.000Z", carol: "2026-09-07T13:00:00.000Z" },
      "bob",
      lastMessage,
    );
    expect(result.map((m) => m.userId)).toEqual(["carol"]);
  });

  it("test_seen_by_excludes_a_member_with_no_read_cursor", () => {
    const result = computeLastMessageSeenBy(
      [alice, bob],
      {},
      "alice",
      lastMessage,
    );
    expect(result).toEqual([]);
  });
});
