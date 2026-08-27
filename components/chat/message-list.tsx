"use client";

// F4 (docs/advanced-chat-plan.md): renders a channel's top-level messages.
// Mirrors components/task/comment-list.tsx's "list + auto-scroll" shape,
// simplified: no rich-text editor (plain <textarea> composer per this
// milestone's clarified scope -- see message-composer.tsx), no edit/delete
// UI yet (F9), no reactions yet (F8), no threads panel yet (F10).
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
import { formatDistanceToNow } from "date-fns";
import { Pencil, Trash2, SmilePlus } from "lucide-react";

import { extractPlainText, docFromPlainText } from "@/lib/comments/rich-text";
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
import type { ChatMessage } from "@/components/chat/channel-view";
import { toggleMessageReaction } from "@/lib/actions/chat-reactions";
import type { MessageReactionSummary } from "@/lib/queries/chat";
// F7 (docs/advanced-chat-plan.md): green online dot next to a message
// author's avatar -- reads from the workspace-wide presence context
// mounted in the workspace layout (WorkspacePresenceProvider), no
// per-message-list Presence channel of its own.
import { useIsUserOnline } from "@/components/nav/workspace-presence-provider";
// F9 (docs/advanced-chat-plan.md): edit/delete own messages -- reuses the
// same Server Actions F3 already ships (editMessage/deleteMessage); realtime
// (use-chat-messages-realtime) propagates the resulting UPDATE to every open
// client, this component doesn't need to locally patch state after success.
import { editMessage, deleteMessage } from "@/lib/actions/chat-messages";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const AUTO_SCROLL_THRESHOLD_PX = 120;

function authorOf(
  userId: string,
  members: { userId: string; name: string | null; email: string | null; avatarUrl: string | null }[],
): UserAvatarPerson {
  const member = members.find((m) => m.userId === userId);
  return {
    id: userId,
    name: member?.name ?? null,
    email: member?.email ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

function authorLabel(
  userId: string,
  members: { userId: string; name: string | null; email: string | null }[],
): string {
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
  members: { userId: string; name: string | null; email: string | null; avatarUrl: string | null }[];
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

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🙏", "🔥"];

export function MessageList({
  messages,
  members,
  currentUserId,
  replyCounts,
  onOpenThread,
  reactions,
}: {
  messages: ChatMessage[];
  members: { userId: string; name: string | null; email: string | null; avatarUrl: string | null }[];
  currentUserId?: string;
  replyCounts?: Record<string, number>;
  onOpenThread?: (messageId: string) => void;
  reactions?: Map<string, MessageReactionSummary[]>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageCountRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isNewMessage = messages.length > messageCountRef.current;
    messageCountRef.current = messages.length;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldAutoScroll =
      !isNewMessage || distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX;

    if (shouldAutoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Always snap to bottom on the very first render (initial channel open).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // F13: resolves a stored mention's CURRENT display name against
        // this channel's already-fetched `members` list, mirroring
        // comment-list.tsx's own `extractPlainText(..., resolveLabel)`
        // usage -- never a raw user id shown to a reader.
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
}: {
  message: ChatMessage;
  isOwn: boolean;
  bodyText: string;
  sameSenderAsPrevious: boolean;
  members: { userId: string; name: string | null; email: string | null; avatarUrl: string | null }[];
  replyCounts?: Record<string, number>;
  onOpenThread?: (messageId: string) => void;
  messageReactions: MessageReactionSummary[];
  currentUserId?: string;
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

  const handleDelete = useCallback(async () => {
    if (!window.confirm("Delete this message?")) return;
    await deleteMessage(message.id);
  }, [message.id]);

  return (
    <div
      className={sameSenderAsPrevious ? "group relative flex gap-3 pl-11" : "group relative flex gap-3 pt-3"}
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
              {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
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
        ) : (
          <p
            className={
              message.deletedAt
                ? "whitespace-pre-wrap text-sm italic text-muted-foreground"
                : "whitespace-pre-wrap text-sm"
            }
          >
            {bodyText || (message.deletedAt ? "Message deleted" : "")}
            {!message.deletedAt && message.editedAt && (
              <span className="ml-1 text-xs text-muted-foreground">(edited)</span>
            )}
          </p>
        )}
        {!message.deletedAt && onOpenThread && (
          <div className="mt-0.5 flex items-center gap-3">
            {replyCounts?.[message.id] ? (
              <button
                type="button"
                onClick={() => onOpenThread(message.id)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {replyCounts[message.id]}{" "}
                {replyCounts[message.id] === 1 ? "reply" : "replies"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenThread(message.id)}
                className="text-xs text-muted-foreground hover:underline"
              >
                Reply
              </button>
            )}
          </div>
        )}
      </div>
      {!message.deletedAt && messageReactions.length > 0 && (
        <div className="absolute -bottom-5 left-11 flex gap-1">
          {messageReactions.map((r) => {
            const reacted = currentUserId ? r.userIds.includes(currentUserId) : false;
            return (
              <button
                key={r.emoji}
                type="button"
                title={`${r.userIds.length} reaction${r.userIds.length !== 1 ? "s" : ""}`}
                onClick={() => void toggleMessageReaction(message.id, r.emoji)}
                className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs ${reacted ? "border-primary/40 bg-primary/10" : "border-border bg-background hover:bg-accent"}`}
              >
                {r.emoji} <span className="text-muted-foreground">{r.userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}
      {isOwn && !message.deletedAt && !editing && hovered && (
        <div className="absolute right-0 top-0 flex items-center gap-0.5 rounded border border-border bg-background p-0.5 shadow-sm">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React ${emoji}`}
              onClick={() => void toggleMessageReaction(message.id, emoji)}
              className="rounded p-0.5 text-sm hover:bg-accent"
            >
              {emoji}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title="Edit"
            onClick={() => { setEditText(bodyText); setEditing(true); }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            title="Delete"
            onClick={() => void handleDelete()}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
