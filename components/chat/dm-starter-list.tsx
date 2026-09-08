"use client";

// Team 1:1 DMs: "Direct Messages" section of the chat sidebar. Lists every
// workspace member the caller can DM (lib/queries/chat.ts's
// getDmCandidates already excludes the caller and `client`-role members)
// and finds-or-creates the DM channel on click via
// findOrCreateDirectMessage (lib/actions/chat-channels.ts), then navigates
// into it -- same "server action, then router.push the returned id"
// pattern components/chat's own create-channel dialog uses.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { findOrCreateDirectMessage } from "@/lib/actions/chat-channels";

export type DmCandidateSummary = {
  userId: string;
  name: string | null;
  email: string | null;
};

// Bug fix: an already-open DM (a `kind='dm'` channel the caller belongs
// to) used to also render here as a "start a new DM" candidate button
// via getDmCandidates -- same person shown twice in the sidebar (once as
// the open channel under "Chat", once as a candidate here). Existing DMs
// now render here (their proper "Direct Messages" home) as ordinary
// channel links, and getDmCandidates itself excludes anyone the caller
// already has a DM channel with, so no person can appear in both this
// list's candidates and its existing-conversations links.
export type ExistingDmSummary = {
  id: string;
  name: string | null;
  unreadCount: number;
};

export function DmStarterList({
  workspaceSlug,
  workspaceId,
  existingDms = [],
  candidates,
}: {
  workspaceSlug: string;
  workspaceId: string;
  existingDms?: ExistingDmSummary[];
  candidates: DmCandidateSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelect(userId: string) {
    setError(null);
    setPendingUserId(userId);
    startTransition(async () => {
      const result = await findOrCreateDirectMessage(workspaceId, userId);
      setPendingUserId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/w/${workspaceSlug}/chat/${result.data.id}`);
    });
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex min-h-0 flex-shrink-0 flex-col border-t"
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex min-h-9 items-center justify-between px-3 py-2 text-micro font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:text-sidebar-foreground max-md:min-h-11"
          >
            <span>Direct Messages</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                open ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
        }
      />
      <CollapsibleContent className="min-h-0 overflow-y-auto">
        {error && (
          <p className="px-3 pb-1 text-micro text-destructive" role="alert">
            {error}
          </p>
        )}
        {existingDms.length === 0 && candidates.length === 0 ? (
          <p className="px-3 pb-3 text-mini text-sidebar-foreground/60">
            No other team members yet.
          </p>
        ) : (
          <nav aria-label="Direct messages" className="flex flex-col gap-0.5 px-2 pb-2">
            {existingDms.map((dm) => {
              const href = `/w/${workspaceSlug}/chat/${dm.id}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={dm.id}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-mini font-medium transition-colors max-md:min-h-11",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <MessageCircle
                    className="size-3.5 shrink-0 text-sidebar-foreground/50"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {dm.name ?? "Direct message"}
                  </span>
                  {dm.unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="h-4 min-w-4 shrink-0 rounded-full px-1 text-[10px] leading-none"
                    >
                      {dm.unreadCount > 99 ? "99+" : dm.unreadCount}
                    </Badge>
                  )}
                </Link>
              );
            })}
            {candidates.map((candidate) => (
              <button
                key={candidate.userId}
                type="button"
                disabled={isPending && pendingUserId === candidate.userId}
                onClick={() => handleSelect(candidate.userId)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-mini font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground max-md:min-h-11",
                  isPending && pendingUserId === candidate.userId && "opacity-60",
                )}
              >
                <MessageCircle
                  className="size-3.5 shrink-0 text-sidebar-foreground/50"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">
                  {candidate.name ?? candidate.email ?? "Team member"}
                </span>
              </button>
            ))}
          </nav>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
