"use client";

// F4 (docs/advanced-chat-plan.md): renders a channel's top-level messages.
// Mirrors components/task/comment-list.tsx's "list + auto-scroll" shape.
//
// Faza A (docs/chat-slack-parity-plan.md): three fixes landed together
// here, all pre-existing gaps rather than new features --
//   - BUG-1: messages render through the shared RichTextRenderer (same
//     component task comments/descriptions already use) instead of
//     extractPlainText's flattened string, so a pasted link is an actual
//     clickable <a>, not inert text -- see use-rich-text-renderer.ts.
//   - BUG-2: attachments (uploaded by the composer, linked to the message
//     by sendMessage) are now actually rendered -- see chat-attachment.tsx.
//   - BUG-3/4/5: the old hover toolbar hardcoded 6 emoji that didn't match
//     the DB's reaction allow-list (3 of them silently failed), reactions
//     only appeared for the message's OWN sender to add, and the reaction
//     summary chips were absolutely positioned over the next message.
//     Replaced by the already-built (but previously unused anywhere --
//     BUG-16) MessageReactionPicker, which uses the real allow-list, is
//     available on every message, and renders in normal flow.
//
// Grouping: consecutive messages from the same sender within 5 minutes of
// each other render without repeating the author header -- purely visual,
// no schema change, same idea the plan's F4 section calls for.
//
// Auto-scroll: scrolls to the bottom on a new message UNLESS the viewer has
// scrolled up to read older messages -- checks
// `scrollHeight - scrollTop - clientHeight < threshold` before
// auto-scrolling, the same pattern used by every other chat-style list in
// this codebase (comment-list.tsx's own doc comment references the same
// UX problem).

import { useEffect, useRef, useState, useCallback } from "react";
import { formatDistanceToNow, format, isAfter, subHours } from "date-fns";
import { Pencil, Trash2, Reply } from "lucide-react";

import { cn } from "@/lib/utils";
import { extractPlainText, docFromPlainText } from "@/lib/comments/rich-text";
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
import type { ChatMessage, ChatMessageAttachment } from "@/components/chat/channel-view";
import { editMessage, deleteMessage } from "@/lib/actions/chat-messages";
import { useRichTextRenderer } from "@/components/chat/use-rich-text-renderer";
import { ChatAttachment } from "@/components/chat/chat-attachment";
import { LinkPreviewCard } from "@/components/chat/link-preview-card";
import { firstPreviewableUrl } from "@/lib/chat/extract-links";
import {
  MessageReactionPicker,
  type MessageReactionSummary,
} from "@/components/chat/message-reaction-picker";
// F7 (docs/advanced-chat-plan.md): green online dot next to a message
// author's avatar -- reads from the workspace-wide presence context
// mounted in the workspace layout (WorkspacePresenceProvider), no
// per-message-list Presence channel of its own.
import { useIsUserOnline } from "@/components/nav/workspace-presence-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const AUTO_SCROLL_THRESHOLD_PX = 120;

type ChatMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

function authorOf(userId: string, members: ChatMember[]): UserAvatarPerson {
  const member = members.find((m) => m.userId === userId);
  return {
    id: userId,
    name: member?.name ?? null,
    email: member?.email ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

function authorLabel(userId: string, members: ChatMember[]): string {
  const member = members.find((m) => m.userId === userId);
  return member?.name || member?.email || userId;
}

// F7: avatar + green online dot, positioned bottom-right over the avatar --
// same relative-wrapper/absolute-dot shape as any other "badge on avatar"
// UI in this codebase (e.g. NotificationBell's unread badge), sized to sit
// inside the 8-unit (`size-8`) avatar this list uses.
function MessageAuthorAvatar({
  userId,
  members,
}: {
  userId: string;
  members: ChatMember[];
}) {
  const isOnline = useIsUserOnline(userId);
  return (
    <div className="relative size-8 shrink-0">
      <UserAvatar person={authorOf(userId, members)} className="size-8" />
      {isOnline && (
        <span
          aria-label="Online"
          title="Online"
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-green-500"
        />
      )}
    </div>
  );
}

export function MessageList({
  messages,
  members,
  currentUserId,
  replyCounts,
  onOpenThread,
  reactions,
  onReactionsChange,
  mentionSuggestions,
  hasMoreMessages,
  isLoadingMoreMessages,
  onLoadMoreMessages,
  highlightMessageId,
}: {
  messages: ChatMessage[];
  members: ChatMember[];
  currentUserId?: string;
  replyCounts?: Record<string, number>;
  onOpenThread?: (messageId: string) => void;
  reactions?: Map<string, MessageReactionSummary[]>;
  // Faza A: propagates MessageReactionPicker's optimistic post-toggle
  // state back up to ChannelView's master `reactionsByMessage` map, so it
  // stays the single source of truth (the realtime subscription writes to
  // the same map for every other client's toggles).
  onReactionsChange?: (messageId: string, next: MessageReactionSummary[]) => void;
  // Faza A (BUG-1): passed down from ChannelView instead of recomputed
  // here, so the composer and the renderer's mention-chip resolution never
  // drift from the same member list.
  mentionSuggestions?: { id: string; label: string }[];
  // W10 (pagination hardening): "Load earlier messages" affordance --
  // backend already supported a `before` cursor (getChannelMessages), this
  // wires it into the UI. Optional so callers that don't paginate (e.g.
  // any future test harness rendering a bare list) don't need to pass
  // these.
  hasMoreMessages?: boolean;
  isLoadingMoreMessages?: boolean;
  onLoadMoreMessages?: () => void;
  // Faza D (docs/chat-slack-parity-plan.md): a notification's `?highlight=`
  // deep link -- scrolled into view and briefly flashed once, instead of
  // this list's usual "always end up at the bottom" behaviour.
  highlightMessageId?: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageCountRef = useRef(0);
  const firstMessageIdRef = useRef<string | null>(null);
  const messageRowRefs = useRef(new Map<string, HTMLDivElement>());
  const [flashedMessageId, setFlashedMessageId] = useState<string | null>(
    highlightMessageId ?? null,
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const firstMessageId = messages[0]?.id ?? null;
    // A "load earlier messages" prepend changes which message is first
    // without necessarily changing the count in a way we want to treat as
    // "new message at the bottom" -- detect it explicitly so the older
    // page doesn't yank the viewer's scroll position down to the bottom.
    const isPrepend =
      firstMessageIdRef.current !== null &&
      firstMessageId !== firstMessageIdRef.current &&
      messages.length > messageCountRef.current;

    const isNewMessage =
      !isPrepend && messages.length > messageCountRef.current;

    messageCountRef.current = messages.length;
    firstMessageIdRef.current = firstMessageId;

    if (isPrepend) {
      // Keep the viewer looking at the same message they were looking at
      // before older messages were prepended above it.
      return;
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldAutoScroll =
      !isNewMessage || distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX;

    if (shouldAutoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Always snap to bottom on the very first render (initial channel open)
  // -- skipped when a notification link asked to land on a specific
  // older message instead (the highlight effect below takes over).
  useEffect(() => {
    if (highlightMessageId) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Faza D: scrolls the `?highlight=` target into view once and flashes
  // it briefly. Guarded by a ref (not just re-running when the target
  // becomes findable) so a later message arriving via realtime doesn't
  // re-trigger the scroll back to an old highlight.
  const hasScrolledToHighlightRef = useRef(false);
  useEffect(() => {
    if (!highlightMessageId || hasScrolledToHighlightRef.current) return;
    const el = messageRowRefs.current.get(highlightMessageId);
    if (!el) return;
    hasScrolledToHighlightRef.current = true;
    el.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setFlashedMessageId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightMessageId, messages]);

  const richText = useRichTextRenderer();

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        No messages yet. Say hello!
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-3"
      aria-label="Messages"
    >
      {hasMoreMessages && onLoadMoreMessages && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={onLoadMoreMessages}
            disabled={isLoadingMoreMessages}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {isLoadingMoreMessages ? "Loading…" : "Load earlier messages"}
          </button>
        </div>
      )}
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const sameSenderAsPrevious =
          previous &&
          previous.senderId === message.senderId &&
          new Date(message.createdAt).getTime() -
            new Date(previous.createdAt).getTime() <
            GROUP_WINDOW_MS &&
          !previous.deletedAt === !message.deletedAt;

        const isOwn = message.senderId === currentUserId;
        // Pre-hydration/no-JS fallback text, and the initial value for the
        // plain-text edit textarea below -- rich rendering (once `richText`
        // resolves) is what viewers actually see once mounted.
        const bodyText = message.deletedAt
          ? "Message deleted"
          : extractPlainText(message.bodyJson, (userId) =>
              authorLabel(userId, members),
            );

        return (
          <MessageRow
            key={message.id}
            message={message}
            isOwn={isOwn}
            bodyText={bodyText}
            sameSenderAsPrevious={!!sameSenderAsPrevious}
            members={members}
            replyCounts={replyCounts}
            onOpenThread={onOpenThread}
            messageReactions={reactions?.get(message.id) ?? []}
            currentUserId={currentUserId}
            onReactionsChange={onReactionsChange}
            mentionSuggestions={mentionSuggestions}
            RichTextRenderer={richText}
            isHighlighted={message.id === flashedMessageId}
            registerRef={(el) => {
              if (el) messageRowRefs.current.set(message.id, el);
              else messageRowRefs.current.delete(message.id);
            }}
          />
        );
      })}
    </div>
  );
}

function MessageRow({
  message,
  isOwn,
  bodyText,
  sameSenderAsPrevious,
  members,
  replyCounts,
  onOpenThread,
  messageReactions,
  currentUserId,
  onReactionsChange,
  mentionSuggestions,
  RichTextRenderer,
  isHighlighted,
  registerRef,
}: {
  message: ChatMessage;
  isOwn: boolean;
  bodyText: string;
  sameSenderAsPrevious: boolean;
  members: ChatMember[];
  replyCounts?: Record<string, number>;
  onOpenThread?: (messageId: string) => void;
  messageReactions: MessageReactionSummary[];
  currentUserId?: string;
  onReactionsChange?: (messageId: string, next: MessageReactionSummary[]) => void;
  mentionSuggestions?: { id: string; label: string }[];
  RichTextRenderer: ReturnType<typeof useRichTextRenderer>;
  /** Faza D: true for the ~2s window right after scrolling this row into
   * view from a notification's `?highlight=` link. */
  isHighlighted?: boolean;
  registerRef?: (el: HTMLDivElement | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(bodyText);
  const [hovered, setHovered] = useState(false);

  const handleEdit = useCallback(async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === bodyText) { setEditing(false); return; }
    await editMessage(message.id, docFromPlainText(trimmed));
    setEditing(false);
  }, [editText, bodyText, message.id]);

  // F083: was `window.confirm` — the one unstyled, unthemed,
  // keyboard-inconsistent confirmation left in the app, on a permanent
  // deletion, in the highest-frequency surface. Converted to the same
  // AlertDialog pattern this codebase already uses everywhere else (18+
  // call sites), rendered from the Trash2 button below.
  const handleDelete = useCallback(async () => {
    await deleteMessage(message.id);
  }, [message.id]);

  const attachments: ChatMessageAttachment[] = message.attachments ?? [];

  return (
    <div
      ref={registerRef}
      className={cn(
        "group relative flex gap-3 rounded-md transition-colors duration-1000",
        sameSenderAsPrevious ? "pl-11" : "pt-3",
        // Faza D: a notification's `?highlight=` target briefly flashes
        // (2s, see the effect in MessageList) so the viewer's eye lands
        // on the right row instead of just silently scrolling there.
        isHighlighted && "bg-primary/10",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!sameSenderAsPrevious && (
        <MessageAuthorAvatar userId={message.senderId} members={members} />
      )}
      <div className="min-w-0 flex-1">
        {!sameSenderAsPrevious && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">
              {isOwn ? "You" : authorLabel(message.senderId, members)}
            </span>
            <span className="text-xs text-muted-foreground">
              {isAfter(new Date(message.createdAt), subHours(new Date(), 24))
                ? formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })
                : format(new Date(message.createdAt), "MMM d, HH:mm")}
            </span>
          </div>
        )}
        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea
              autoFocus
              className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleEdit(); }
                if (e.key === "Escape") { setEditing(false); setEditText(bodyText); }
              }}
            />
            <div className="flex gap-1 text-xs">
              <button type="button" onClick={() => void handleEdit()} className="text-primary hover:underline">Save</button>
              <span className="text-muted-foreground">·</span>
              <button type="button" onClick={() => { setEditing(false); setEditText(bodyText); }} className="text-muted-foreground hover:underline">Cancel</button>
            </div>
          </div>
        ) : message.deletedAt ? (
          <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">
            Message deleted
          </p>
        ) : RichTextRenderer ? (
          // Faza A: the shared renderer's `<a>` inherits this app's global
          // reset (color: inherit, no underline) same as task comments --
          // a real, clickable link that's visually indistinguishable from
          // plain text. Scoped to chat only (not touching the shared
          // editor component or the global reset) since a visibly-a-link
          // link was the literal ask.
          <div className="text-sm [&_a]:text-primary! [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/40 hover:[&_a]:decoration-primary">
            <RichTextRenderer
              content={message.bodyJson}
              aria-label={`Message from ${authorLabel(message.senderId, members)}`}
              mentionSuggestions={mentionSuggestions}
            />
            {message.editedAt && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm">
            {bodyText}
            {message.editedAt && (
              <span className="ml-1 text-xs text-muted-foreground">(edited)</span>
            )}
          </p>
        )}
        {!message.deletedAt && (() => {
          const previewUrl = firstPreviewableUrl(message.bodyJson);
          return previewUrl ? <LinkPreviewCard url={previewUrl} /> : null;
        })()}
        {!message.deletedAt && attachments.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {attachments.map((attachment) => (
              <ChatAttachment key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}
        {!message.deletedAt && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <MessageReactionPicker
              messageId={message.id}
              reactions={messageReactions}
              members={members}
              currentUserId={currentUserId}
              canReact={!!currentUserId}
              onChange={(next) => onReactionsChange?.(message.id, next)}
            />
            {!!replyCounts?.[message.id] && onOpenThread && (
              <button
                type="button"
                onClick={() => onOpenThread(message.id)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {replyCounts[message.id]}{" "}
                {replyCounts[message.id] === 1 ? "reply" : "replies"}
              </button>
            )}
          </div>
        )}
      </div>
      {!message.deletedAt && !editing && hovered && (
        <div className="absolute right-0 top-0 flex items-center gap-0.5 rounded border border-border bg-background p-0.5 shadow-sm">
          {onOpenThread && (
            <button
              type="button"
              title="Reply in thread"
              onClick={() => onOpenThread(message.id)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Reply className="size-3.5" />
            </button>
          )}
          {isOwn && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <button
                type="button"
                title="Edit"
                onClick={() => { setEditText(bodyText); setEditing(true); }}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <button
                      type="button"
                      title="Delete"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this message?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This can&apos;t be undone. The message will be removed for
                      everyone in this channel.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleDelete()}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      )}
    </div>
  );
}
