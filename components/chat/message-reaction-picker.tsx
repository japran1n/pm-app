"use client";

// F8 (docs/advanced-chat-plan.md): emoji reactions on chat messages.
// Literal copy-paste of components/task/comment-reactions.tsx's
// CommentReactions per the plan's explicit F8 instruction, adapted to
// messages/members prop shapes -- same accessible-Popover, keyboard-
// operable, allow-list-limited picker, no new dependency or second
// source of truth. See that file's doc comment for the full rationale
// (unchanged here).
import { useState, useTransition } from "react";
import { SmilePlus } from "lucide-react";
import { toast } from "sonner";

import { toggleMessageReaction } from "@/lib/actions/chat-reactions";
import { REACTION_EMOJI_ALLOWLIST } from "@/lib/validation/comment-reactions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** One emoji's aggregate state on a single message. */
export type MessageReactionSummary = {
  emoji: string;
  /** User ids of everyone currently reacting with this emoji. */
  userIds: string[];
};

export type MessageReactionMember = {
  userId: string;
  name: string | null;
  email: string | null;
};

function reactorNames(
  userIds: string[],
  members: MessageReactionMember[],
  currentUserId?: string,
): string {
  return userIds
    .map((userId) => {
      if (currentUserId && userId === currentUserId) return "You";
      const member = members.find((m) => m.userId === userId);
      return member?.name || member?.email || userId;
    })
    .join(", ");
}

// Pure, exported so tests can exercise the optimistic-update logic
// directly without a DOM -- identical shape to comment-reactions.tsx's
// applyReactionToggle.
export function applyMessageReactionToggle(
  reactions: MessageReactionSummary[],
  emoji: string,
  reacted: boolean,
  userId: string,
): MessageReactionSummary[] {
  const next = reactions.map((reaction) => ({
    ...reaction,
    userIds: [...reaction.userIds],
  }));
  const existing = next.find((reaction) => reaction.emoji === emoji);

  if (reacted) {
    if (existing) {
      if (!existing.userIds.includes(userId)) {
        existing.userIds.push(userId);
      }
    } else {
      next.push({ emoji, userIds: [userId] });
    }
  } else if (existing) {
    existing.userIds = existing.userIds.filter((id) => id !== userId);
  }

  return next.filter((reaction) => reaction.userIds.length > 0);
}

function handlePickerKeyDown(
  keyDownEvent: React.KeyboardEvent<HTMLDivElement>,
) {
  if (keyDownEvent.key !== "ArrowRight" && keyDownEvent.key !== "ArrowLeft") {
    return;
  }
  const menu = keyDownEvent.currentTarget;
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  );
  if (items.length === 0) return;
  const currentIndex = items.findIndex(
    (item) => item === document.activeElement,
  );
  const delta = keyDownEvent.key === "ArrowRight" ? 1 : -1;
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + delta + items.length) % items.length;
  keyDownEvent.preventDefault();
  items[nextIndex]?.focus();
}

export function MessageReactionPicker({
  messageId,
  reactions,
  members,
  currentUserId,
  canReact,
  onChange,
}: {
  messageId: string;
  /** This message's current reaction summary, empty array if none. */
  reactions: MessageReactionSummary[];
  /** Channel members, used to resolve reactor display names. */
  members: MessageReactionMember[];
  /** Viewer's own user id -- controls the "own reaction" mark and whether
   * toggling is attempted at all. */
  currentUserId?: string;
  /** Whether the viewer is a channel member (reaction affordances render
   * only for members -- mirrors CommentReactions' canReact gate). */
  canReact: boolean;
  /** Called with the next reactions array after a successful toggle, so
   * the caller (MessageList) can update its own local message state. */
  onChange: (next: MessageReactionSummary[]) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);

  function toggle(emoji: string) {
    if (!canReact || !currentUserId) return;
    setPendingEmoji(emoji);
    startTransition(async () => {
      const result = await toggleMessageReaction(messageId, emoji);
      if (result.ok) {
        onChange(
          applyMessageReactionToggle(
            reactions,
            result.data.emoji,
            result.data.reacted,
            currentUserId,
          ),
        );
      } else {
        toast.error(result.error);
      }
      setPendingEmoji(null);
    });
  }

  const visibleReactions = reactions.filter(
    (reaction) => reaction.userIds.length > 0,
  );

  if (visibleReactions.length === 0 && !canReact) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Reactions">
      {visibleReactions.map((reaction) => {
        const mine = currentUserId
          ? reaction.userIds.includes(currentUserId)
          : false;
        const names = reactorNames(reaction.userIds, members, currentUserId);
        return (
          <Popover key={reaction.emoji}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-pressed={mine}
                  aria-label={`${reaction.emoji} reaction, ${reaction.userIds.length} ${
                    reaction.userIds.length === 1 ? "person" : "people"
                  }: ${names}`}
                  disabled={
                    !canReact || (isPending && pendingEmoji === reaction.emoji)
                  }
                  onClick={() => toggle(reaction.emoji)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro",
                    mine
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-transparent text-foreground hover:bg-accent",
                    !canReact && "cursor-default opacity-80",
                  )}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span>{reaction.userIds.length}</span>
                </button>
              }
            />
            <PopoverContent className="w-auto max-w-64 p-2 text-micro">
              {names}
            </PopoverContent>
          </Popover>
        );
      })}

      {canReact && (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Add reaction"
              >
                <SmilePlus className="size-3.5" aria-hidden="true" />
              </Button>
            }
          />
          <PopoverContent className="w-auto p-1.5">
            <div
              role="menu"
              aria-label="Pick an emoji"
              className="flex gap-0.5"
              onKeyDown={handlePickerKeyDown}
            >
              {REACTION_EMOJI_ALLOWLIST.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={`React with ${emoji}`}
                  disabled={isPending && pendingEmoji === emoji}
                  onClick={() => toggle(emoji)}
                  className="rounded-md p-1 text-regular hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
