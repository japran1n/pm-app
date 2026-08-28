"use client";

// F7 (docs/advanced-chat-plan.md): workspace-wide online-presence context.
// Mounted once in the workspace layout (app/(workspace)/w/[workspaceSlug]/
// layout.tsx), alongside MembershipProvider, so every client component
// further down the tree (chat channel member lists, message author
// avatars, the sidebar's chat nav, etc.) can read "who's online" without
// each mounting its own Presence channel -- same "thin context, single
// server/track source of truth" convention MembershipProvider documents in
// its own file header.
//
// Tracking happens HERE (workspace-layout mount), not per-channel -- per
// F7's own spec item 1: "online in the app" is a broader signal than "in
// this channel", and lib/realtime/workspace-presence-channel.ts's
// `acquireWorkspacePresence` already ref-counts the underlying Presence
// channel per workspace, so mounting this provider once per workspace
// layout (it never unmounts while the user stays in that workspace) is the
// correct single subscriber; a channel-scoped component just reads the
// resulting online-id set from context instead of tracking its own
// presence entry.

import { createContext, useContext, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { acquireWorkspacePresence } from "@/lib/realtime/workspace-presence-channel";

const WorkspacePresenceContext = createContext<Set<string>>(new Set());

export function WorkspacePresenceProvider({
  workspaceId,
  currentUserId,
  children,
}: {
  workspaceId: string;
  currentUserId: string;
  children: React.ReactNode;
}) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let release: (() => void) | null = null;
    let untrackNow: (() => void) | null = null;

    // Same "subscribe only after the session resolves" fix documented by
    // use-chat-messages-realtime.ts / use-typing-indicator.ts -- guarantees
    // `realtime.setAuth` has already run with the real session token before
    // this channel joins.
    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      const handle = acquireWorkspacePresence(
        supabase,
        workspaceId,
        currentUserId,
        (ids) => setOnlineUserIds(new Set(ids)),
      );
      setOnlineUserIds(new Set(handle.onlineUserIds));
      release = handle.release;
      untrackNow = handle.untrackNow;
    });

    // F7 acceptance: closing the tab should drop the user from the online
    // list "in a reasonable time" -- `beforeunload` is a best-effort nicety
    // on top of Presence's own server-side heartbeat/timeout (see
    // acquireWorkspacePresence's `untrackNow` doc comment), not the actual
    // correctness mechanism.
    const handleBeforeUnload = () => untrackNow?.();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      release?.();
    };
  }, [workspaceId, currentUserId]);

  return (
    <WorkspacePresenceContext.Provider value={onlineUserIds}>
      {children}
    </WorkspacePresenceContext.Provider>
  );
}

/** The set of user ids currently online in this workspace (empty set, never
 * `null`, when rendered outside a <WorkspacePresenceProvider> -- same
 * "permissive/empty default" convention as useMembership()'s `null`, just
 * expressed as "nobody's online" rather than "no data" since every caller
 * here just checks `.has(userId)`.) */
export function useWorkspacePresence(): Set<string> {
  return useContext(WorkspacePresenceContext);
}

/** Convenience: is this specific user currently online in the workspace? */
export function useIsUserOnline(userId: string | null | undefined): boolean {
  const online = useWorkspacePresence();
  if (!userId) return false;
  return online.has(userId);
}
