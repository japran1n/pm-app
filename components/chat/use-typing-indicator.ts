// F6 (docs/advanced-chat-plan.md): "<name> is typing..." hook.
//
// Two responsibilities in one hook (mirrors the "smallest possible client
// boundary" convention of use-chat-messages-realtime.ts, but this feature
// needs both a subscriber AND a sender on the same topic, so they're
// combined here rather than split):
//
// - `sendTyping()`: called on every keystroke by the composer, but
//   actually broadcasts at most once per `SEND_THROTTLE_MS` -- the plan's
//   "debounce 2s" requirement, implemented as a leading-edge throttle
//   (send immediately on the first keystroke of a burst, ignore further
//   calls for 2s) so the indicator appears promptly for other viewers
//   instead of only after the user pauses.
// - `typingUsers`: the list of OTHER users currently typing, built from
//   received broadcast events. Each user is removed `STALE_TIMEOUT_MS`
//   after their last event -- this is what makes the indicator self-heal
//   when a tab closes without an explicit "stopped typing" event (F6's
//   other acceptance criterion), since no further events will ever
//   refresh that timer once the sender is gone.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  sendTypingBroadcast,
  subscribeToTypingBroadcast,
  type TypingBroadcastEvent,
} from "@/lib/realtime/chat-typing-channel";

const SEND_THROTTLE_MS = 2000;
const STALE_TIMEOUT_MS = 3000;

export type TypingUser = {
  userId: string;
  name: string | null;
};

export function useTypingIndicator(
  channelId: string | null | undefined,
  currentUserId: string,
  currentUserName: string | null,
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const staleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    const staleTimers = staleTimersRef.current;
    if (!channelId) return;

    const supabase = createClient();
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void supabase.auth.getSession().then(() => {
      if (cancelled) return;
      unsubscribe = subscribeToTypingBroadcast(supabase, channelId, (event: TypingBroadcastEvent) => {
        if (event.userId === currentUserId) return;

        const existingTimer = staleTimers.get(event.userId);
        if (existingTimer) clearTimeout(existingTimer);

        setTypingUsers((previous) => {
          const withoutUser = previous.filter((u) => u.userId !== event.userId);
          return [...withoutUser, { userId: event.userId, name: event.name }];
        });

        const timer = setTimeout(() => {
          staleTimers.delete(event.userId);
          setTypingUsers((previous) => previous.filter((u) => u.userId !== event.userId));
        }, STALE_TIMEOUT_MS);
        staleTimers.set(event.userId, timer);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      staleTimers.forEach((timer) => clearTimeout(timer));
      staleTimers.clear();
      setTypingUsers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, currentUserId]);

  const sendTyping = useCallback(() => {
    if (!channelId) return;
    const now = Date.now();
    if (now - lastSentAtRef.current < SEND_THROTTLE_MS) return;
    lastSentAtRef.current = now;

    const supabase = createClient();
    sendTypingBroadcast(supabase, channelId, { userId: currentUserId, name: currentUserName });
  }, [channelId, currentUserId, currentUserName]);

  return { typingUsers, sendTyping };
}
