// F3 (docs/advanced-chat-plan.md): unit tests for lib/actions/chat-messages.ts's
// sendMessage/editMessage/deleteMessage Server Actions.
//
// Mirrors tests/unit/favorites-action.test.ts's mocked-client pattern:
// unauthenticated rejection, invalid-input rejection, and the action's own
// channel-membership re-check (RLS's messages_insert_channel_members /
// messages_update_sender_only are the real enforcement boundary -- covered
// separately by a live-DB RLS integration test per this repo's convention
// -- these tests exercise only the action-layer logic a mocked client can
// drive deterministically).

import { describe, expect, it, vi, beforeEach } from "vitest";

// chat-messages.ts imports getThreadMessages from lib/queries/chat.ts, which
// is `import "server-only"` -- not resolvable in this plain-node Vitest
// environment. Mirrors the same mock already used by
// tests/unit/chat-workspace-channels-unread-count.test.ts for the identical
// reason.
vi.mock("server-only", () => ({}));

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

function makeSupabaseMock(opts: {
  user: { id: string } | null;
  isChannelMember: boolean;
  insertError?: { message: string } | null;
  existingMessage?: {
    id: string;
    sender_id: string;
    channel_id: string;
    deleted_at: string | null;
  } | null;
  updateError?: { message: string } | null;
}) {
  const insertedRow = {
    id: MESSAGE_ID,
    channel_id: CHANNEL_ID,
    sender_id: opts.user?.id,
    body_json: { type: "doc", content: [] },
    parent_message_id: null,
    edited_at: null,
    deleted_at: null,
    created_at: "2026-08-27T00:00:00.000Z",
  };

  const messagesTable = {
    // requireChannelMembership / editMessage / deleteMessage lookups, and
    // sendMessage's insert chain, all go through `.from("messages")`.
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: opts.isChannelMember ? { channel_id: CHANNEL_ID } : null,
            error: null,
          }),
        }),
        maybeSingle: async () => ({
          data: opts.existingMessage ?? null,
          error: null,
        }),
      }),
    }),
    insert: () => ({
      select: () => ({
        single: async () => ({
          data: opts.insertError ? null : insertedRow,
          error: opts.insertError ?? null,
        }),
      }),
    }),
    update: () => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: opts.updateError
              ? null
              : { id: MESSAGE_ID, body_json: { type: "doc", content: [] }, edited_at: "2026-08-27T00:10:00.000Z", deleted_at: "2026-08-27T00:10:00.000Z" },
            error: opts.updateError ?? null,
          }),
        }),
      }),
    }),
  };

  const channelMembersTable = {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: opts.isChannelMember ? { channel_id: CHANNEL_ID } : null,
            error: null,
          }),
        }),
      }),
    }),
  };

  const channelsTable = {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { workspace_id: "w1", workspaces: { slug: "acme" } },
          error: null,
        }),
      }),
    }),
  };

  // BUG FIX test support: sendMessage's linkAndLoadAttachments (invoked
  // whenever attachmentIds is non-empty) touches `message_attachments` --
  // stubbed here to a no-op empty result, since the attachment-linking
  // behaviour itself is out of scope for this guard's tests.
  const messageAttachmentsTable = {
    update: () => ({
      in: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              select: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    from: (table: string) => {
      if (table === "messages") return messagesTable;
      if (table === "channel_members") return channelMembersTable;
      if (table === "channels") return channelsTable;
      if (table === "message_attachments") return messageAttachmentsTable;
      throw new Error(`unexpected table: ${table}`);
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

// BUG FIX (empty/whitespace-only messages saved to the DB): an empty doc
// (`content: []`) is now rejected by sendMessage/editMessage's own
// server-side guard (see lib/actions/chat-messages.ts), so a body used to
// exercise the "happy path" here must carry real text -- the guard's
// negative-case tests below are what exercise the empty-content path.
const validBody = {
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
};
const emptyBody = { type: "doc" as const, content: [] };
const whitespaceOnlyBody = {
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }],
};

describe("sendMessage (F3)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("test_F3_sendMessage_rejects_an_unauthenticated_caller", async () => {
    mockSupabase = makeSupabaseMock({ user: null, isChannelMember: true });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const result = await sendMessage(CHANNEL_ID, validBody);
    expect(result.ok).toBe(false);
  });

  it("test_F3_sendMessage_rejects_invalid_channel_id", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
    });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const result = await sendMessage("not-a-uuid", validBody);
    expect(result.ok).toBe(false);
  });

  it("test_F3_sendMessage_rejects_a_caller_who_has_not_joined_the_channel", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: false,
    });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const result = await sendMessage(CHANNEL_ID, validBody);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it("test_F3_sendMessage_succeeds_for_a_joined_channel_member", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
    });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const result = await sendMessage(CHANNEL_ID, validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.channelId).toBe(CHANNEL_ID);
      expect(result.data.senderId).toBe(USER_ID);
    }
  });

  // BUG FIX regression coverage: confirmed live, messages with a completely
  // empty body were reaching the `messages` table (sender + timestamp, no
  // text, no attachment). This is the authoritative server-side guard --
  // it must reject regardless of what client-side bug or race let an empty
  // body through.
  it("test_BUGFIX_sendMessage_rejects_a_completely_empty_body_with_no_attachments", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
    });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const result = await sendMessage(CHANNEL_ID, emptyBody);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("test_BUGFIX_sendMessage_rejects_a_whitespace_only_body_with_no_attachments", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
    });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const result = await sendMessage(CHANNEL_ID, whitespaceOnlyBody);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("test_BUGFIX_sendMessage_allows_an_empty_body_when_attachments_are_present", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
    });
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    // Attachment-only message: empty text body is fine as long as at least
    // one attachment id is being linked -- mirrors the composer's own
    // `hasContent || hasAttachments` submit gate.
    const result = await sendMessage(CHANNEL_ID, emptyBody, null, [
      "55555555-5555-4555-8555-555555555555",
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("editMessage / deleteMessage (F3, F9's server-side re-check)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("test_F3_editMessage_rejects_editing_someone_elses_message", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
      existingMessage: {
        id: MESSAGE_ID,
        sender_id: OTHER_USER_ID,
        channel_id: CHANNEL_ID,
        deleted_at: null,
      },
    });
    const { editMessage } = await import("@/lib/actions/chat-messages");

    const result = await editMessage(MESSAGE_ID, validBody);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/only edit your own/i);
    }
  });

  it("test_F3_editMessage_succeeds_for_the_sender_own_message", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
      existingMessage: {
        id: MESSAGE_ID,
        sender_id: USER_ID,
        channel_id: CHANNEL_ID,
        deleted_at: null,
      },
    });
    const { editMessage } = await import("@/lib/actions/chat-messages");

    const result = await editMessage(MESSAGE_ID, validBody);
    expect(result.ok).toBe(true);
  });

  it("test_BUGFIX_editMessage_rejects_editing_a_message_down_to_empty", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
      existingMessage: {
        id: MESSAGE_ID,
        sender_id: USER_ID,
        channel_id: CHANNEL_ID,
        deleted_at: null,
      },
    });
    const { editMessage } = await import("@/lib/actions/chat-messages");

    const result = await editMessage(MESSAGE_ID, emptyBody);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("test_F3_deleteMessage_rejects_deleting_someone_elses_message", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
      existingMessage: {
        id: MESSAGE_ID,
        sender_id: OTHER_USER_ID,
        channel_id: CHANNEL_ID,
        deleted_at: null,
      },
    });
    const { deleteMessage } = await import("@/lib/actions/chat-messages");

    const result = await deleteMessage(MESSAGE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/only delete your own/i);
    }
  });

  it("test_F3_deleteMessage_soft_deletes_the_senders_own_message", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
      existingMessage: {
        id: MESSAGE_ID,
        sender_id: USER_ID,
        channel_id: CHANNEL_ID,
        deleted_at: null,
      },
    });
    const { deleteMessage } = await import("@/lib/actions/chat-messages");

    const result = await deleteMessage(MESSAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.deletedAt).toBeTruthy();
    }
  });

  it("test_F3_deleteMessage_rejects_a_message_already_deleted", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: USER_ID },
      isChannelMember: true,
      existingMessage: {
        id: MESSAGE_ID,
        sender_id: USER_ID,
        channel_id: CHANNEL_ID,
        deleted_at: "2026-08-27T00:00:00.000Z",
      },
    });
    const { deleteMessage } = await import("@/lib/actions/chat-messages");

    const result = await deleteMessage(MESSAGE_ID);
    expect(result.ok).toBe(false);
  });
});
