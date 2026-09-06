import { z } from "zod";

import { REACTION_EMOJI_ALLOWLIST } from "@/lib/validation/comment-reactions";

// F2 (docs/advanced-chat-plan.md): Zod schemas backing lib/actions/chat-channels.ts
// and lib/actions/chat-messages.ts. Mirrors this codebase's existing
// validation-layer convention (lib/validation/tasks.ts, lib/validation/comments.ts):
// client-facing rejection happens here, the DB CHECK constraints
// (supabase/migrations/20260904020000_chat_system.sql) are the real
// enforcement boundary.

// AS-scope: `kind` mirrors `channels.kind` CHECK ('channel' | 'dm'). `name`
// is required only for kind='channel' (channels_channel_kind_requires_name
// constraint) — enforced here too so a bad create request fails fast with a
// friendly message instead of a raw Postgres constraint error.
export const createChannelSchema = z
  .object({
    workspaceId: z.string().uuid("Invalid workspace."),
    kind: z.enum(["channel", "dm"]),
    name: z
      .string()
      .trim()
      .min(1, "Channel name is required.")
      .max(100, "Channel name must be 100 characters or fewer.")
      .optional()
      .nullable(),
    projectId: z.string().uuid("Invalid project.").optional().nullable(),
    memberIds: z.array(z.string().uuid("Invalid member.")).optional(),
  })
  .refine(
    (value) => value.kind !== "channel" || !!value.name?.trim(),
    { message: "Channel name is required.", path: ["name"] },
  );

export const addChannelMemberSchema = z.object({
  channelId: z.string().uuid("Invalid channel."),
  userId: z.string().uuid("Invalid member."),
});

export const removeChannelMemberSchema = z.object({
  channelId: z.string().uuid("Invalid channel."),
  userId: z.string().uuid("Invalid member."),
});

// Team 1:1 DM find-or-create (lib/actions/chat-channels.ts's
// findOrCreateDirectMessage).
export const findOrCreateDmSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  otherUserId: z.string().uuid("Invalid member."),
});

// F3: loose structural validation of a message's Tiptap-shaped JSON body.
// Mirrors lib/validation/comments.ts's commentBodyJsonSchema -- not a full
// allow-list re-implementation, just enough to reject an obviously
// malformed payload before it reaches the database.
export const messageBodyJsonSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

// Used by F3's sendMessage — schema lives here (not chat-messages.ts's own
// file) per the plan's F2 item list, which names all three schemas
// together as one lib/validation/chat.ts unit.
export const sendMessageSchema = z.object({
  channelId: z.string().uuid("Invalid channel."),
  bodyJson: messageBodyJsonSchema,
  // F10 (thread replies) will pass this; optional now so sendMessage's
  // signature doesn't need to change when that feature lands.
  parentMessageId: z.string().uuid("Invalid parent message.").optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  messageId: z.string().uuid("Invalid message."),
  bodyJson: messageBodyJsonSchema,
});

export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const deleteMessageSchema = z.object({
  messageId: z.string().uuid("Invalid message."),
});

export type DeleteMessageInput = z.infer<typeof deleteMessageSchema>;

// F8: emoji reactions on chat messages. Reuses the exact allow-list
// lib/validation/comment-reactions.ts already established for
// comment_reactions -- same CHECK constraint list, single source of
// truth, per the plan's "literal copy-paste" instruction for this
// feature.
export const toggleMessageReactionSchema = z.object({
  messageId: z.string().uuid("Invalid message."),
  emoji: z.enum(REACTION_EMOJI_ALLOWLIST, {
    message: "That emoji isn't available for reactions.",
  }),
});

export type ToggleMessageReactionInput = z.infer<
  typeof toggleMessageReactionSchema
>;
