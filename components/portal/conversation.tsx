"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addComment } from "@/lib/actions/comments";
import type { PortalComment } from "@/lib/queries/portal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PortalConversation({
  taskId,
  comments,
  teamName,
}: {
  taskId: string;
  comments: PortalComment[];
  /** Attribution fallback for any author the client cannot resolve — the
   * team's profiles are not readable by a client, and "Acme Studio" is a
   * truer label than an empty name or a raw user id. */
  teamName: string;
}) {
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    startTransition(async () => {
      // No `internal` argument: the action forces a client's comment to be
      // non-internal, and passing anything here would suggest a client
      // could choose otherwise.
      const result = await addComment(taskId, trimmed);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setText("");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium tracking-tight">Conversation</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Ask {teamName} anything about this item.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="flex flex-col gap-1.5 rounded-lg border border-border p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">
                  {comment.isMine
                    ? "You"
                    : (comment.authorName ?? teamName)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(comment.createdAt)}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{comment.text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          placeholder={`Reply to ${teamName}...`}
          disabled={isPending}
          aria-label="Your message"
        />
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || text.trim().length === 0}
          className="w-fit"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Sending...
            </>
          ) : (
            "Send"
          )}
        </Button>
      </div>
    </div>
  );
}
