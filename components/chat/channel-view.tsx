"use client";

// F4 (docs/advanced-chat-plan.md): the main thread view -- MessageList +
// MessageComposer, wired to F3's sendMessage Server Action and
// useChatMessagesRealtime hook. Server Component caller (the chat route
// page) fetches the initial message page + channel member list and passes
// them down as props, same "server-fetched, passed down" convention as
// components/task/comment-list.tsx / TaskDetailSheet.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { JSONContent } from "@tiptap/react";

import { sendMessage, getChannelMessagesAction } from "@/lib/actions/chat-messages";
import { markChannelRead } from "@/lib/actions/chat-read";
import { useChatMessagesRealtime } from "@/components/chat/use-chat-messages-realtime";
import { useMessageReactionsRealtime } from "@/components/chat/use-message-reactions-realtime";
import { useReadReceiptsRealtime } from "@/components/chat/use-read-receipts-realtime";
import { computeLastMessageSeenBy } from "@/lib/chat/read-receipts";
import { useTypingIndicator } from "@/components/chat/use-typing-indicator";
import { MessageList } from "@/components/chat/message-list";
import { MessageComposer } from "@/components/chat/message-composer";
import { ThreadPanel } from "@/components/chat/thread-panel";
import type { MessageReactionSummary } from "@/lib/queries/chat";
// F7 (docs/advanced-chat-plan.md): "who's online in this channel" strip in
// the header, reading from the workspace-wide presence context.
import { useWorkspacePresence } from "@/components/nav/workspace-presence-provider";
import { UserAvatar } from "@/components/user-avatar";

// F5 (docs/advanced-chat-plan.md): debounce window between markChannelRead
// calls triggered by incoming messages while this channel stays open --
// "debounced, ne na svaki keystroke"-equivalent for the read-cursor bump,
// so a burst of messages doesn't fire one Server Action call each.
const MARK_READ_DEBOUNCE_MS = 1500;

// Faza A (docs/chat-slack-parity-plan.md, BUG-2): this previously declared
// `storagePath` as the required field, but lib/actions/chat-messages.ts's
// linkAndLoadAttachments (the ONLY place that ever produced a value of
// this type) has always returned `{ id, fileName, mimeType, fileSize,
// signedUrl }` -- no `storagePath` at all. Since handleSend below never
// forwarded attachmentIds to sendMessage in the first place, this type
// mismatch was never exercised. Both shapes are now legitimate: a
// just-sent message carries `signedUrl` (chat-messages.ts); a page-loaded
// message carries `storagePath` (lib/queries/chat.ts's
// getMessageAttachments) and ChatAttachment mints its own signed URL on
// demand -- see components/chat/chat-attachment.tsx.
export type ChatMessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize?: number | null;
  signedUrl?: string | null;
  storagePath?: string;
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
  initialReactions,
  initialAttachments,
  initialMentionName,
  initialReadReceipts,
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
  // Faza A: reactions/attachments for this page's initial top-level
  // messages, keyed by message id -- see getMessageReactions/
  // getMessageAttachments in lib/queries/chat.ts. Plain objects (not
  // Maps) because that's what actually survives a Server->Client
  // Component prop, same convention initialReplyCounts already uses.
  initialReactions?: Record<string, MessageReactionSummary[]>;
  initialAttachments?: Record<string, ChatMessageAttachment[]>;
  // Paket E ("Piši nam" on the portal team card): the display name to
  // prefill the composer with as "@Name " on first render, resolved
  // server-side by the caller from a `?mention=<userId>` query param
  // (see app/(portal)/.../conversation/page.tsx). Undefined for every
  // other caller of this shared component (the staff-side chat route
  // never passes it), so the composer's default (empty) behaviour is
  // unchanged there.
  initialMentionName?: string;
  // Read receipts: each member's `channel_members.last_read_at` read
  // cursor, keyed by user id -- seeds the "Seen by" avatar strip under the
  // channel's last message, kept current afterwards by
  // useReadReceiptsRealtime below. Optional so any other caller of this
  // shared component that doesn't fetch it (there are none today) simply
  // renders no "Seen by" strip rather than crashing.
  initialReadReceipts?: Record<string, string | null>;
}) {
  // Initial page load is newest-first (getChannelMessages, F3), reversed
  // here to oldest-first for top-to-bottom rendering, same convention
  // comment-list.tsx documents for its own `comments` prop. Attachments
  // (Faza A) are merged in here since getChannelMessages itself never
  // joins message_attachments -- see getMessageAttachments's doc comment.
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    [...initialMessages]
      .sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .map((m) => ({
        ...m,
        attachments: initialAttachments?.[m.id] ?? m.attachments,
      })),
  );

  // Faza A (BUG-3/4/5): live reaction state for this channel's top-level
  // messages, seeded from the page's initial fetch and kept current by
  // useMessageReactionsRealtime below. MessageReactionPicker's own
  // `onChange` (an immediate local update after a successful toggle) and
  // the realtime subscription (an update for every OTHER client's toggle,
  // and a second, idempotent confirmation of the caller's own) both write
  // through this same setter, so the two paths can never drift.
  const [reactionsByMessage, setReactionsByMessage] = useState<
    Map<string, MessageReactionSummary[]>
  >(() => new Map(Object.entries(initialReactions ?? {})));

  function applyReactionEvent(
    messageId: string,
    emoji: string,
    userId: string,
    add: boolean,
  ) {
    setReactionsByMessage((previous) => {
      const next = new Map(previous);
      const current = next.get(messageId) ?? [];
      const existing = current.find((r) => r.emoji === emoji);
      let updated: MessageReactionSummary[];
      if (add) {
        if (existing) {
          if (existing.userIds.includes(userId)) return previous;
          updated = current.map((r) =>
            r.emoji === emoji ? { ...r, userIds: [...r.userIds, userId] } : r,
          );
        } else {
          updated = [...current, { emoji, userIds: [userId] }];
        }
      } else if (existing) {
        updated = current
          .map((r) =>
            r.emoji === emoji
              ? { ...r, userIds: r.userIds.filter((id) => id !== userId) }
              : r,
          )
          .filter((r) => r.userIds.length > 0);
      } else {
        return previous;
      }
      next.set(messageId, updated);
      return next;
    });
  }

  useMessageReactionsRealtime(channelId, (event) => {
    applyReactionEvent(
      event.messageId,
      event.emoji,
      event.userId,
      event.eventType === "INSERT",
    );
  });

  // Read receipts: each member's read cursor, seeded from the page's
  // initial fetch and kept current by every other member's
  // markChannelRead calls (which UPDATE their own channel_members row)
  // arriving over useReadReceiptsRealtime below. Used only to render a
  // "Seen by" avatar strip under the channel's LAST message -- per-message
  // receipts would be too noisy, same reasoning F7's online-dot strip
  // documents for scoping presence to the header instead of every row.
  const [readReceipts, setReadReceipts] = useState<Record<string, string | null>>(
    () => initialReadReceipts ?? {},
  );

  useReadReceiptsRealtime(channelId, (event) => {
    setReadReceipts((previous) => ({
      ...previous,
      [event.userId]: event.lastReadAt,
    }));
  });

  function handleReactionsChange(
    messageId: string,
    next: MessageReactionSummary[],
  ) {
    setReactionsByMessage((previous) => {
      const updated = new Map(previous);
      updated.set(messageId, next);
      return updated;
    });
  }

  // W10 (pagination hardening): getChannelMessages' default page size --
  // the initial server fetch (app/(workspace)/w/[workspaceSlug]/chat/
  // [channelId]/page.tsx) doesn't pass an explicit `limit`, so a full
  // initial page means "there may be more" (fewer than this means we've
  // already reached the channel's start).
  const CHANNEL_MESSAGE_PAGE_SIZE = 50;
  const [hasMoreMessages, setHasMoreMessages] = useState(
    initialMessages.length >= CHANNEL_MESSAGE_PAGE_SIZE,
  );
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);

  async function handleLoadMoreMessages() {
    if (isLoadingMoreMessages || !hasMoreMessages) return;
    const oldest = messages[0];
    if (!oldest) return;
    setIsLoadingMoreMessages(true);
    try {
      const olderPage = await getChannelMessagesAction(channelId, {
        before: oldest.createdAt,
        limit: CHANNEL_MESSAGE_PAGE_SIZE,
      });
      setHasMoreMessages(olderPage.length >= CHANNEL_MESSAGE_PAGE_SIZE);
      if (olderPage.length > 0) {
        setMessages((previous) => {
          const existingIds = new Set(previous.map((m) => m.id));
          const toPrepend: ChatMessage[] = [...olderPage]
            .filter((m) => !existingIds.has(m.id))
            .sort(
              (a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            )
            // getChannelMessagesAction's return type doesn't carry
            // attachments (the `before`-cursor query never joins them,
            // same as F3's original page load before F11 added the
            // attachments join elsewhere) -- explicit `undefined` matches
            // ChatMessage.attachments' optional shape rather than relying
            // on structural leniency.
            .map((m) => ({ ...m, attachments: undefined }));
          return [...toPrepend, ...previous];
        });
      }
    } finally {
      setIsLoadingMoreMessages(false);
    }
  }

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

  // Faza D (docs/chat-slack-parity-plan.md): a notification's deep link
  // (lib/notifications/chat-link.ts's chatNotificationHref) carries
  // `?highlight=<messageId>` always, plus `?thread=<parentMessageId>` when
  // the target is a threaded reply (which never appears in the main list
  // -- getChannelMessages filters to parent_message_id is null). `thread`
  // opens the right panel directly; `highlight` is passed to MessageList
  // to scroll-to/flash whichever top-level message it names (the
  // highlighted message itself, for a mention/DM, or nothing further here
  // for a thread reply -- ThreadPanel renders replies oldest-first with
  // the newest at the bottom, so simply opening it already puts a fresh
  // reply in view without a separate in-thread highlight).
  const searchParams = useSearchParams();
  const highlightMessageId = searchParams.get("highlight");
  const threadParam = searchParams.get("thread");

  // Adjusted during render (not in a useEffect, per this codebase's own
  // convention -- see chat-nav-list.tsx's identical "previous value ref,
  // compared during render" shape) so a fresh `?thread=` opens the panel
  // in the same render pass as the navigation, not a render -> effect ->
  // extra render cascade.
  const [prevThreadParam, setPrevThreadParam] = useState(threadParam);
  if (threadParam !== prevThreadParam) {
    setPrevThreadParam(threadParam);
    if (threadParam) setActiveThreadId(threadParam);
  }

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

  // Read receipts: which OTHER members have a read cursor at or after the
  // channel's last (top-level) message -- rendered as an avatar strip
  // under only that message (see MessageList's `lastMessageSeenBy` prop).
  const lastMessage = messages[messages.length - 1];
  const lastMessageSeenBy = lastMessage
    ? computeLastMessageSeenBy(members, readReceipts, currentUserId, lastMessage)
    : [];

  // Faza A (BUG-2): `attachmentIds` used to be silently dropped here --
  // the composer already uploaded the files and passed their ids, but
  // this function's signature only accepted `bodyJson`, so `sendMessage`
  // was always called with zero attachments and every upload stayed
  // permanently unlinked. Forwarding it is the entire fix; sendMessage's
  // attachmentIds param already existed and worked (F11).
  async function handleSend(bodyJson: JSONContent, attachmentIds?: string[]) {
    const result = await sendMessage(channelId, bodyJson, undefined, attachmentIds);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // Always upsert: if realtime INSERT arrived first (race), it added the
    // message without attachments. Replace it with the server result which
    // has the fully-linked attachments + signed URLs.
    setMessages((previous) => {
      const exists = previous.some((m) => m.id === result.data.id);
      if (exists) {
        return previous.map((m) =>
          m.id === result.data.id ? (result.data as ChatMessage) : m,
        );
      }
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
        hasMoreMessages={hasMoreMessages}
        isLoadingMoreMessages={isLoadingMoreMessages}
        onLoadMoreMessages={() => void handleLoadMoreMessages()}
        reactions={reactionsByMessage}
        onReactionsChange={handleReactionsChange}
        mentionSuggestions={mentionSuggestions}
        highlightMessageId={threadParam ? null : highlightMessageId}
        lastMessageSeenBy={lastMessageSeenBy}
      />
      <TypingIndicatorLine typingUsers={typingUsers} />
      <MessageComposer
        onSend={handleSend}
        onTyping={sendTyping}
        mentionSuggestions={mentionSuggestions}
        channelId={channelId}
        initialDraft={initialMentionName ? `@${initialMentionName} ` : undefined}
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
