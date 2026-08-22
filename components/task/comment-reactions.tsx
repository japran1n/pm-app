"use client";

// F201: reaction chips under a comment (AS-366: a reaction shows a count
// and who reacted).
//
// Data shape: per the clarified spec's "simpler option, no new
// dependency, no second source of truth" answer, reactions are fetched
// once by the same Server Component caller that already fetches
// `comments`/`members` (matching CommentList's own established
// convention — see its doc comment) and passed down as
// `TaskComment.reactions`, rather than this component doing its own data
// fetch. This also keeps tests/unit/comment-list.test.ts's
// `renderToStaticMarkup` (no DOM/effects, node environment) rendering
// deterministically: reaction chips render straight from props, no effect
// needs to run first.
//
// Names of reactors (AS-366's "who reacted") are resolved the same way
// CommentList resolves comment authors: by matching each reactor's user
// id against the `members` list already loaded once per Sheet open —
// avoiding a second N-per-reaction identity lookup.
//
// Accessible tooltip/popover, not hover-only: each reaction chip opens a
// Popover (components/ui/popover.tsx, already used this way by
// components/task/dependencies.tsx) on click/Enter/Space, listing
// reactor names as real DOM content — not a `title` attribute, which
// would be invisible to keyboard/touch users and unreliable for screen
// readers (mirrors comment-list.tsx's own (edited) marker rationale for
// the same reason).
//
// Emoji picker limited to the allow-list: reuses F200's
// `REACTION_EMOJI_ALLOWLIST` (lib/validation/comment-reactions.ts) as the
// single source of truth, per that file's own doc comment recommending
// exactly this for F201, rather than a second hardcoded copy.
//
// Keyboard operable: every chip and every picker option is a real
// `<button>` (no click-only `<div>`s); the picker's options sit in a
// `role="menu"`/`role="menuitem"` popup, and Left/Right arrow-key
// navigation between them is handled locally rather than pulling in a
// new dependency (Tab already moves focus between menuitems; explicit
// arrow-key handling is layered on top for the "arrow-key navigation"
// requirement).

import { useState, useTransition } from "react";
import { SmilePlus } from "lucide-react";
import { toast } from "sonner";

import { toggleReaction } from "@/lib/actions/comment-reactions";
import { REACTION_EMOJI_ALLOWLIST } from "@/lib/validation/comment-reactions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CommentListMember } from "@/components/task/comment-list";

/** One emoji's aggregate state on a single comment. */
export type CommentReactionSummary = {
  emoji: string;
  /** User ids of everyone currently reacting with this emoji. */
  userIds: string[];
};

function reactorNames(
  userIds: string[],
  members: CommentListMember[],
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
// directly without a DOM (mirrors lib/tasks/reconcile-realtime-comment.ts's
// convention of keeping the reducer testable independent of React).
export function applyReactionToggle(
  reactions: CommentReactionSummary[],
  emoji: string,
  reacted: boolean,
  userId: string,
): CommentReactionSummary[] {
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

export function CommentReactions({
  commentId,
  reactions,
  members,
  currentUserId,
  canReact,
  onChange,
}: {
  commentId: string;
  /** This comment's current reaction summary, empty array if none. */
  reactions: CommentReactionSummary[];
  /** Workspace members, used to resolve reactor display names. */
  members: CommentListMember[];
  /** Viewer's own user id — controls the "own reaction" mark and whether
   * toggling is attempted at all (undefined disables reacting, same
   * permissive-by-omission convention as CommentList's canDelete). */
  currentUserId?: string;
  /** F200's canWrite gate re-verified server-side regardless; this only
   * controls whether the reaction affordances are rendered at all
   * (mirrors CommentList's canPost). */
  canReact: boolean;
  /** Called with the next reactions array after a successful toggle, so
   * the caller (CommentList) can update its own local comment state —
   * same optimistic-update-in-parent-state convention CommentList already
   * uses for add/edit/delete. */
  onChange: (next: CommentReactionSummary[]) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);

  function toggle(emoji: string) {
    if (!canReact || !currentUserId) return;
    setPendingEmoji(emoji);
    startTransition(async () => {
      const result = await toggleReaction(commentId, emoji);
      if (result.ok) {
        onChange(
          applyReactionToggle(
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
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
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
            <PopoverContent className="w-auto max-w-64 p-2 text-xs">
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
                  className="rounded-md p-1 text-base hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
