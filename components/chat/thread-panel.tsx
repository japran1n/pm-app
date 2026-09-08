"use client";

// F10 (docs/advanced-chat-plan.md): the thread side panel -- opens when the
// user clicks "Reply" on a top-level message (or its "N replies" line) in
// MessageList. Shows the original message + every reply, plus a composer
// scoped to that thread (sendMessage's `parentMessageId` param, already
// supported since F3). Mirrors components/task/task-detail-sheet.tsx's
// "side panel, own data fetch + own realtime subscription" shape rather
// than lifting thread state into ChannelView, since only one thread panel
// is ever open at a time and it's fully independent of the main message
// list's own state.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { formatDistanceToNow, format, isAfter, subHours } from "date-fns";

import type { JSONContent } from "@tiptap/react";

import { extractPlainText } from "@/lib/comments/rich-text";
import { getThreadMessagesAction, sendMessage } from "@/lib/actions/chat-messages";
import { useChatMessagesRealtime } from "@/components/chat/use-chat-messages-realtime";
import { useRichTextRenderer } from "@/components/chat/use-rich-text-renderer";
import { ChatAttachment } from "@/components/chat/chat-attachment";
import { LinkPreviewCard } from "@/components/chat/link-preview-card";
import { firstPreviewableUrl } from "@/lib/chat/extract-links";
import { MessageComposer } from "@/components/chat/message-composer";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import type { ChatChannelMember, ChatMessage } from "@/components/chat/channel-view";

function authorLabel(userId: string, members: ChatChannelMember[]): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
}

// Faza A (docs/chat-slack-parity-plan.md, BUG-1/BUG-2): shared by the
// parent message and every reply below -- rich-rendered body (falling
// back to plain text before the lazy RichTextRenderer import resolves,
// same pattern message-list.tsx uses) plus any attachments, so the two
// render sites can never drift from each other.
function ThreadMessageBody({
  message,
  RichTextRenderer,
  mentionSuggestions,
}: {
  message: ChatMessage;
  RichTextRenderer: ReturnType<typeof useRichTextRenderer>;
  mentionSuggestions: { id: string; label: string }[];
}) {
  if (message.deletedAt) {
    return (
      <p className="whitespace-pre-wrap text-mini italic text-muted-foreground">
        Message deleted
      </p>
    );
  }
  return (
    <>
      {RichTextRenderer ? (
        <div className="text-mini [&_a]:text-primary! [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/40 hover:[&_a]:decoration-primary">
          <RichTextRenderer
            content={message.bodyJson}
            mentionSuggestions={mentionSuggestions}
          />
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-mini">
          {extractPlainText(message.bodyJson)}
        </p>
      )}
      {(() => {
        const previewUrl = firstPreviewableUrl(message.bodyJson);
        return previewUrl ? <LinkPreviewCard url={previewUrl} /> : null;
      })()}
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {message.attachments.map((attachment) => (
            <ChatAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </>
  );
}

export function ThreadPanel({
  channelId,
  parentMessageId,
  members,
  currentUserId,
  onClose,
  onReplyCountChange,
}: {
  channelId: string;
  parentMessageId: string;
  members: ChatChannelMember[];
  currentUserId: string;
  onClose: () => void;
  // Keeps ChannelView's "N replies" line in sync while the panel is open
  // and another (or the same) client posts a reply.
  onReplyCountChange: (parentMessageId: string, count: number) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getThreadMessagesAction(parentMessageId).then((data) => {
      if (cancelled) return;
      setMessages(data as ChatMessage[]);
      setError(null);
      setLoadedThreadId(parentMessageId);
    });

    return () => {
      cancelled = true;
    };
  }, [parentMessageId]);

  // Avoid rendering the previous thread's messages while the new thread is
  // still loading (parentMessageId changed but the fetch above hasn't
  // resolved yet).
  const isLoadingCurrentThread = loadedThreadId !== parentMessageId;
  const visibleMessages = isLoadingCurrentThread ? null : messages;

  // F10 acceptance: reply count updates realtime for another user who has
  // the thread panel open -- this reuses the same channel-wide Realtime
  // subscription every other chat surface uses, filtered down to this
  // thread's parent/replies.
  useChatMessagesRealtime(channelId, (event) => {
    const isThisThread =
      event.message.id === parentMessageId ||
      event.message.parentMessageId === parentMessageId;
    if (!isThisThread) return;

    setMessages((previous) => {
      if (!previous) return previous;
      if (event.type === "insert") {
        if (previous.some((m) => m.id === event.message.id)) return previous;
        const next = [...previous, event.message as ChatMessage];
        const replyCount = next.filter((m) => m.id !== parentMessageId).length;
        onReplyCountChange(parentMessageId, replyCount);
        return next;
      }
      return previous.map((m) =>
        m.id === event.message.id ? { ...m, ...(event.message as ChatMessage) } : m,
      );
    });
  });

  // F13: same channel-scoped mention suggestion source as ChannelView's
  // composer.
  const mentionSuggestions = members.map((m) => ({
    id: m.userId,
    label: m.name || m.email || m.userId,
  }));

  // Faza A (docs/chat-slack-parity-plan.md, BUG-1): same lazy RichText
  // renderer as message-list.tsx, so a link/mention/list in a reply
  // renders identically to one in the main channel view.
  const RichTextRenderer = useRichTextRenderer();

  // Faza A (BUG-2): `attachmentIds` used to be silently dropped here too
  // (same gap as ChannelView's handleSend) -- the composer only gets an
  // attach button at all once `channelId` is passed to it below.
  //
  // Bug fix (reported after the merge, duplicate thread replies): this
  // used to blindly append `result.data` with no id check, unlike
  // ChannelView's own handleSend. The realtime INSERT event for this
  // exact message (useChatMessagesRealtime above) can arrive and get
  // appended (it already deduped by id) BEFORE this awaited sendMessage
  // call resolves -- realtime push is often faster than the HTTP
  // round-trip back to the caller that sent it. When that race won, this
  // function's own append had nothing guarding it from adding the same
  // message a second time. Same `previous.some(...)` guard as
  // ChannelView's handleSend closes it.
  async function handleSend(bodyJson: JSONContent, attachmentIds?: string[]) {
    const result = await sendMessage(channelId, bodyJson, parentMessageId, attachmentIds);
    if (!result.ok) {
      setError(result.error);
      return { ok: false, error: result.error };
    }
    setMessages((previous) => {
      if (previous?.some((m) => m.id === result.data.id)) return previous;
      const next = previous ? [...previous, result.data as ChatMessage] : [result.data as ChatMessage];
      if (previous) {
        const replyCount = next.filter((m) => m.id !== parentMessageId).length;
        onReplyCountChange(parentMessageId, replyCount);
      }
      return next;
    });
    return { ok: true };
  }

  const parent = visibleMessages?.find((m) => m.id === parentMessageId) ?? null;
  const replies = visibleMessages?.filter((m) => m.id !== parentMessageId) ?? [];

  return (
    <div className="flex h-full w-full min-h-0 flex-col border-l md:w-96" aria-label="Thread">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-mini font-semibold">Thread</h2>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          aria-label="Close thread"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {visibleMessages === null && (
          <p className="text-mini text-muted-foreground">Loading thread...</p>
        )}

        {visibleMessages !== null && !parent && (
          <p className="text-mini text-muted-foreground">
            This message is no longer available.
          </p>
        )}

        {parent && (
          <div className="flex gap-3 pb-4">
            <UserAvatar
              person={{
                id: parent.senderId,
                name: members.find((m) => m.userId === parent.senderId)?.name ?? null,
                email: members.find((m) => m.userId === parent.senderId)?.email ?? null,
                avatarUrl:
                  members.find((m) => m.userId === parent.senderId)?.avatarUrl ?? null,
              }}
              className="size-8 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-mini font-semibold">
                  {parent.senderId === currentUserId
                    ? "You"
                    : authorLabel(parent.senderId, members)}
                </span>
                <span className="text-micro text-muted-foreground">
                  {isAfter(new Date(parent.createdAt), subHours(new Date(), 24))
                    ? formatDistanceToNow(new Date(parent.createdAt), { addSuffix: true })
                    : format(new Date(parent.createdAt), "MMM d, HH:mm")}
                </span>
              </div>
              <ThreadMessageBody
                message={parent}
                RichTextRenderer={RichTextRenderer}
                mentionSuggestions={mentionSuggestions}
              />
            </div>
          </div>
        )}

        {replies.length > 0 && (
          <div className="border-t pt-3">
            <p className="pb-2 text-micro font-medium text-muted-foreground">
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </p>
            <div className="flex flex-col gap-3">
              {replies.map((reply) => (
                <div key={reply.id} className="flex gap-3">
                  <UserAvatar
                    person={{
                      id: reply.senderId,
                      name:
                        members.find((m) => m.userId === reply.senderId)?.name ?? null,
                      email:
                        members.find((m) => m.userId === reply.senderId)?.email ?? null,
                      avatarUrl:
                        members.find((m) => m.userId === reply.senderId)?.avatarUrl ??
                        null,
                    }}
                    className="size-7 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-mini font-semibold">
                        {reply.senderId === currentUserId
                          ? "You"
                          : authorLabel(reply.senderId, members)}
                      </span>
                      <span className="text-micro text-muted-foreground">
                        {isAfter(new Date(reply.createdAt), subHours(new Date(), 24))
                          ? formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })
                          : format(new Date(reply.createdAt), "MMM d, HH:mm")}
                      </span>
                    </div>
                    <ThreadMessageBody
                      message={reply}
                      RichTextRenderer={RichTextRenderer}
                      mentionSuggestions={mentionSuggestions}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="px-4 pb-1 text-micro text-destructive">{error}</p>}
      <MessageComposer
        onSend={handleSend}
        disabled={!parent}
        mentionSuggestions={mentionSuggestions}
        channelId={channelId}
      />
    </div>
  );
}
