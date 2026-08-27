"use client";

// F4 (docs/advanced-chat-plan.md): the main thread view -- MessageList +
// MessageComposer, wired to F3's sendMessage Server Action and
// useChatMessagesRealtime hook. Server Component caller (the chat route
// page) fetches the initial message page + channel member list and passes
// them down as props, same "server-fetched, passed down" convention as
// components/task/comment-list.tsx / TaskDetailSheet.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { JSONContent } from "@tiptap/react";

import { sendMessage } from "@/lib/actions/chat-messages";
import { markChannelRead } from "@/lib/actions/chat-read";
import { useChatMessagesRealtime } from "@/components/chat/use-chat-messages-realtime";
import { useTypingIndicator } from "@/components/chat/use-typing-indicator";
import { MessageList } from "@/components/chat/message-list";
import { MessageComposer } from "@/components/chat/message-composer";
import { ThreadPanel } from "@/components/chat/thread-panel";
// F7 (docs/advanced-chat-plan.md): "who's online in this channel" strip in
// the header, reading from the workspace-wide presence context.
import { useWorkspacePresence } from "@/components/nav/workspace-presence-provider";
import { UserAvatar } from "@/components/user-avatar";

// F5 (docs/advanced-chat-plan.md): debounce window between markChannelRead
// calls triggered by incoming messages while this channel stays open --
// "debounced, ne na svaki keystroke"-equivalent for the read-cursor bump,
// so a burst of messages doesn't fire one Server Action call each.
const MARK_READ_DEBOUNCE_MS = 1500;

export type ChatMessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  storagePath: string;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  senderId: string;
  bodyJson: JSONContent;
  parentMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments?: ChatMessageAttachment[];
};

export type ChatChannelMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export function ChannelView({
  workspaceSlug,
  channelId,
  channelName,
  initialMessages,
  members,
  currentUserId,
  initialReplyCounts,
}: {
  workspaceSlug: string;
  channelId: string;
  channelName: string;
  initialMessages: ChatMessage[];
  members: ChatChannelMember[];
  currentUserId: string;
  // F10 (docs/advanced-chat-plan.md): reply count per top-level message id,
  // for the "N replies" line under each message.
  initialReplyCounts?: Record<string, number>;
}) {
  // Initial page load is newest-first (getChannelMessages, F3), reversed
  // here to oldest-first for top-to-bottom rendering, same convention
  // comment-list.tsx documents for its own `comments` prop.
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    [...initialMessages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
  );

  // F6: broadcast-based typing indicator -- see components/chat/
  // use-typing-indicator.ts and lib/realtime/chat-typing-channel.ts.
  const currentUserName = members.find((m) => m.userId === currentUserId)?.name ?? null;
  const { typingUsers, sendTyping } = useTypingIndicator(channelId, currentUserId, currentUserName);

  // F7: which OTHER channel members are currently online, for the header's
  // member strip -- reads the workspace-wide presence set the layout
  // already tracks, no per-channel Presence subscription of its own.
  const onlineUserIds = useWorkspacePresence();
  const onlineMembers = members.filter(
    (m) => m.userId !== currentUserId && onlineUserIds.has(m.userId),
  );

  // F5: bump the caller's own read-cursor (channel_members.last_read_at)
  // on-mount of this channel, and again -- debounced -- for each new
  // message received while it stays open, per F5's spec item 1.
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // F10: reply count per top-level message ("N replies" line in
  // MessageList) and which thread (if any) is currently open in the side
  // panel. Kept separate from `messages` state above since thread replies
  // are never part of the main channel's message list (per F10's spec).
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>(
    initialReplyCounts ?? {},
  );
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  function handleReplyCountChange(parentMessageId: string, count: number) {
    setReplyCounts((previous) => ({ ...previous, [parentMessageId]: count }));
  }

  useEffect(() => {
    void markChannelRead(channelId);

    return () => {
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }
    };
  }, [channelId]);

  function scheduleMarkRead() {
    if (markReadTimerRef.current) return;
    markReadTimerRef.current = setTimeout(() => {
      markReadTimerRef.current = null;
      void markChannelRead(channelId);
    }, MARK_READ_DEBOUNCE_MS);
  }

  useChatMessagesRealtime(channelId, (event) => {
    // F10: a reply never joins the main top-level list, but its own
    // "N replies" count still needs to bump live for a viewer who has the
    // thread panel closed (ThreadPanel handles the count update itself
    // while its own panel is open, via onReplyCountChange).
    if (event.message.parentMessageId) {
      if (event.type === "insert" && event.message.parentMessageId !== activeThreadId) {
        const parentId = event.message.parentMessageId;
        setReplyCounts((previous) => ({
          ...previous,
          [parentId]: (previous[parentId] ?? 0) + 1,
        }));
      }
      return;
    }

    setMessages((previous) => {
      if (event.type === "insert") {
        if (previous.some((m) => m.id === event.message.id)) return previous;
        return [...previous, event.message as ChatMessage];
      }
      // update (edit/soft-delete)
      return previous.map((m) =>
        m.id === event.message.id ? { ...m, ...(event.message as ChatMessage) } : m,
      );
    });

    if (event.type === "insert") {
      scheduleMarkRead();
    }
  });

  // F13: mention suggestions scoped to this channel's already-fetched
  // `members` prop -- never a second client-side fetch, same "server-
  // fetched, passed down" convention comment-list.tsx documents for its
  // own `mentionSuggestions`.
  const mentionSuggestions = members.map((m) => ({
    id: m.userId,
    label: m.name || m.email || m.userId,
  }));

  async function handleSend(bodyJson: JSONContent) {
    const result = await sendMessage(channelId, bodyJson);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    setMessages((previous) => {
      if (previous.some((m) => m.id === result.data.id)) return previous;
      return [...previous, result.data as ChatMessage];
    });
    // The caller sent this message themselves, so their own read-cursor
    // should already cover it -- bump last_read_at immediately rather
    // than waiting for the debounced realtime-triggered path (this
    // client won't receive its own INSERT as "unread" work anyway, but
    // this keeps last_read_at monotonically fresh without relying on
    // that realtime round-trip).
    void markChannelRead(channelId);
    return { ok: true };
  }

  return (
    <div className="flex h-full min-h-0">
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Link
          href={`/w/${workspaceSlug}/chat`}
          aria-label="Back to channels"
          className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">{channelName}</h1>
        {onlineMembers.length > 0 && (
          <div
            className="ml-auto flex items-center -space-x-2"
            aria-label={`${onlineMembers.length} online`}
          >
            {onlineMembers.slice(0, 5).map((member) => (
              <div key={member.userId} className="relative size-6" title={`${member.name ?? member.email ?? "Online"} — online`}>
                <UserAvatar
                  person={{
                    id: member.userId,
                    name: member.name,
                    email: member.email,
                    avatarUrl: member.avatarUrl,
                  }}
                  className="size-6 border-2 border-background"
                />
                <span
                  aria-hidden="true"
                  className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-green-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <MessageList
        messages={messages}
        members={members}
        currentUserId={currentUserId}
        replyCounts={replyCounts}
        onOpenThread={setActiveThreadId}
      />
      <TypingIndicatorLine typingUsers={typingUsers} />
      <MessageComposer
        onSend={handleSend}
        onTyping={sendTyping}
        mentionSuggestions={mentionSuggestions}
      />
    </div>
    {activeThreadId && (
      <ThreadPanel
        channelId={channelId}
        parentMessageId={activeThreadId}
        members={members}
        currentUserId={currentUserId}
        onClose={() => setActiveThreadId(null)}
        onReplyCountChange={handleReplyCountChange}
      />
    )}
    </div>
  );
}

function TypingIndicatorLine({
  typingUsers,
}: {
  typingUsers: { userId: string; name: string | null }[];
}) {
  if (typingUsers.length === 0) return null;

  const names = typingUsers.map((u) => u.name ?? "Someone");
  let text: string;
  if (names.length === 1) {
    text = `${names[0]} is typing…`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing…`;
  } else {
    text = `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} are typing…`;
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className="px-4 pb-1 text-xs italic text-muted-foreground"
    >
      {text}
    </p>
  );
}
