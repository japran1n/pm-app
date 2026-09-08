"use client";

// F12 (docs/advanced-chat-plan.md): search input in the chat sidebar --
// per the plan's UI option 4 ("search input in chat sidebar" vs. reusing a
// header search palette, which doesn't exist yet in this codebase -- no
// F267/searchPalette implementation was found, so this ships as its own
// small, self-contained sidebar control rather than bolting onto
// something that isn't there).
//
// Debounced (300ms) so every keystroke doesn't fire a Server Action call;
// same "debounce free-text input before querying" convention as other
// search-as-you-type inputs in this codebase's task/board filters.

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchMessages } from "@/lib/actions/chat-search";
import type { MessageSearchResult } from "@/lib/queries/chat";

export function ChatMessageSearch({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string;
  workspaceId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageSearchResult[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!trimmedQuery) {
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const data = await searchMessages(workspaceId, trimmedQuery);
        setResults(data);
      });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmedQuery, workspaceId]);

  // Derived directly from the query rather than mirrored via an effect:
  // as soon as the query is cleared, results should read as "no results"
  // without waiting for a render->effect->render round trip.
  const displayedResults = trimmedQuery ? results : null;

  const isOpen = trimmedQuery.length > 0;

  return (
    <div className="relative border-b p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages..."
          aria-label="Search messages"
          className="h-8 pl-7 pr-7 text-mini"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setResults(null);
            }}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {isOpen && (
        <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-md">
          {isPending && (
            <div className="flex items-center gap-2 p-3 text-mini text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Searching...
            </div>
          )}
          {!isPending && displayedResults !== null && displayedResults.length === 0 && (
            <p className="p-3 text-mini text-muted-foreground">
              No messages found.
            </p>
          )}
          {!isPending && displayedResults !== null && displayedResults.length > 0 && (
            <ul className="divide-y">
              {displayedResults.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/w/${workspaceSlug}/chat/${r.channelId}`}
                    className="block p-3 text-mini hover:bg-accent"
                    onClick={() => {
                      setQuery("");
                      setResults(null);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-micro text-muted-foreground">
                      <span className="truncate">
                        {r.channelKind === "dm"
                          ? "Direct message"
                          : (r.channelName ?? "Channel")}
                      </span>
                      <span className="shrink-0">
                        {r.senderName ?? "Someone"}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-foreground">
                      {r.snippet}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
