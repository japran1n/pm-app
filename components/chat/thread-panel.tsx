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
import { formatDistanceToNow } from "date-fns";

import type { JSONContent } from "@tiptap/react";

import { extractPlainText } from "@/lib/comments/rich-text";
import { getThreadMessagesAction, sendMessage } from "@/lib/actions/chat-messages";
import { useChatMessagesRealtime } from "@/components/chat/use-chat-messages-realtime";
import { MessageComposer } from "@/components/chat/message-composer";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import type { ChatChannelMember, ChatMessage } from "@/components/chat/channel-view";

function authorLabel(userId: string, members: ChatChannelMember[]): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
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

  async function handleSend(bodyJson: JSONContent) {
    const result = await sendMessage(channelId, bodyJson, parentMessageId);
    if (!result.ok) {
      setError(result.error);
      return { ok: false, error: result.error };
    }
    setMessages((previous) => {
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
        <h2 className="text-sm font-semibold">Thread</h2>
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
          <p className="text-sm text-muted-foreground">Loading thread...</p>
        )}

        {visibleMessages !== null && !parent && (
          <p className="text-sm text-muted-foreground">
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
                <span className="text-sm font-semibold">
                  {parent.senderId === currentUserId
                    ? "You"
                    : authorLabel(parent.senderId, members)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(parent.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">
                {parent.deletedAt
                  ? "Message deleted"
                  : extractPlainText(parent.bodyJson)}
              </p>
            </div>
          </div>
        )}

        {replies.length > 0 && (
          <div className="border-t pt-3">
            <p className="pb-2 text-xs font-medium text-muted-foreground">
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
                      <span className="text-sm font-semibold">
                        {reply.senderId === currentUserId
                          ? "You"
                          : authorLabel(reply.senderId, members)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(reply.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">
                      {reply.deletedAt
                        ? "Message deleted"
                        : extractPlainText(reply.bodyJson)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="px-4 pb-1 text-xs text-destructive">{error}</p>}
      <MessageComposer
        onSend={handleSend}
        disabled={!parent}
        mentionSuggestions={mentionSuggestions}
      />
    </div>
  );
}
