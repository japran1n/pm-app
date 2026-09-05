// Faza D (docs/chat-slack-parity-plan.md): builds the deep link for any
// chat-originated notification (mention / chat_dm / chat_thread_reply --
// all three write the same payload shape, see lib/queries/notifications.ts's
// `chatMention` field doc comment). Extracted out of notification-panel.tsx's
// own local chatMentionHref so notification-bell.tsx's toast can build the
// exact same link without a second, possibly-drifting copy.
//
// A chat_thread_reply's target message is a REPLY, which never appears in
// the main channel list (getChannelMessages filters to parent_message_id
// is null) -- when `parentMessageId` is present, `?thread=` is added so
// ChannelView opens that thread panel directly instead of landing on a
// channel view with nothing to scroll to; `?highlight=` is always the
// message to actually scroll to/flash, whichever surface (main list or
// thread panel) ends up rendering it.
export function chatNotificationHref(
  workspaceSlug: string,
  chatMention:
    | { channelId: string; messageId: string; parentMessageId?: string }
    | null
    | undefined,
): string | null {
  if (!chatMention) return null;
  const base = `/w/${workspaceSlug}/chat/${encodeURIComponent(chatMention.channelId)}`;
  const params = new URLSearchParams({ highlight: chatMention.messageId });
  if (chatMention.parentMessageId) {
    params.set("thread", chatMention.parentMessageId);
  }
  return `${base}?${params.toString()}`;
}
