// F209 (AS-388): the actual Realtime channel setup for a user's
// notification inbox, extracted out of components/notifications/
// use-notifications-realtime.ts as a plain function so it's testable
// without a React runtime/DOM — same rationale
// lib/tasks/subscribe-comments-realtime.ts (F062/F202) documents for its
// own subscribe* functions, and this repo's vitest config runs with
// `environment: "node"` (no React Testing Library) for exactly this
// reason.
//
// Kept intentionally dumb: given a Supabase client and the current user's
// id, wires up exactly one channel/subscription (channel name
// `notifications:<userId>`) and returns a cleanup function. No React, no
// local component state, no workspace filtering (the caller narrows to
// the active workspace — see the hook's doc comment for why that's a
// client-side concern here, not a subscription-level one).
//
// Security / scoping (this feature's own clarified "Notes" answer): the
// postgres_changes `filter` below is `user_id=eq.<userId>` — the
// subscription itself is scoped to the current user's own notifications
// AT THE SUBSCRIPTION LEVEL, not merely relying on RLS to silently drop
// rows the client shouldn't see plus a client-side filter after delivery.
// This mirrors F206's `notifications_select_own` RLS policy
// (`user_id = auth.uid()`), which still governs delivery independently —
// this filter is a second, redundant narrowing at the transport level,
// not a replacement for RLS.
//
// Requires Realtime to be enabled for `notifications` at the Postgres
// replication level — already done by F206's migration
// (supabase/migrations/20260823020000_create_notifications.sql), which
// added the table to the `supabase_realtime` publication in anticipation
// of this feature.
//
// Only INSERT is subscribed: this feature's scope is "the unread count
// updates live" (AS-388) — new notifications arriving, not existing ones
// changing read state on another device. A `read_at` UPDATE elsewhere is
// handled instead by this feature's tab-focus reconciliation (see the
// hook/Bell component), not by a second postgres_changes UPDATE
// subscription — per the clarified "simpler option, no second source of
// truth" ambiguity answer.
import type { SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type NotificationInsertEvent = {
  id: string;
  userId: string;
  workspaceId: string;
  kind: string;
  createdAt: string;
};

export function subscribeToNotificationsRealtime(
  supabase: SupabaseClient,
  userId: string,
  onInsert: (event: NotificationInsertEvent) => void,
): () => void {
  return acquireSharedTopicChannel<NotificationInsertEvent>(
    supabase,
    `notifications:${userId}`,
    (dispatch) =>
      supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload: {
            new?: {
              id?: string;
              user_id?: string;
              workspace_id?: string;
              kind?: string;
              created_at?: string;
            };
          }) => {
            const row = payload?.new;
            if (!row?.id || !row.user_id || !row.workspace_id || !row.kind) {
              return;
            }
            dispatch({
              id: row.id,
              userId: row.user_id,
              workspaceId: row.workspace_id,
              kind: row.kind,
              createdAt: row.created_at ?? new Date().toISOString(),
            });
          },
        )
        .subscribe(),
    onInsert,
  );
}
