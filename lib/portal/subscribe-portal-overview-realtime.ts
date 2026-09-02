// F008 (AS-018, AS-019, AS-020, AS-024): the actual Realtime channel setup
// for the client portal overview's "Waiting on you" region, extracted as a
// plain function so it's testable without a React runtime/DOM — same
// rationale as lib/board/subscribe-board-realtime.ts (F049): this repo's
// vitest config runs with `environment: "node"`, so logic buried inside a
// `useEffect` would be unverifiable without a browser-like test
// environment. The hook (use-portal-overview-realtime.ts) is a thin
// wrapper: call this in an effect, return the unsubscribe it gives back.
//
// Subscribes to `tasks` with NO row filter -- correctness comes from
// Realtime re-applying the table's RLS SELECT policy before broadcasting,
// the same pattern components/my-tasks/use-my-tasks-realtime.ts already
// uses for a workspace-wide (not single-project) subscription. A portal
// session's RLS already limits what reaches this client to tasks in
// projects it was granted access to, so no extra client-side scoping is
// needed here -- only the client_visible/deleted_at/pending_client_approval
// membership predicate that lib/portal/reconcile-portal-realtime-task.ts
// (F007) already encodes.
//
// One channel for the one table this feature touches, per F003's lesson:
// co-locating unrelated bindings on a single channel means a publication
// gap on either binding's table can silently kill both. This feature only
// ever binds one table (`tasks`) on this topic, so that risk doesn't apply
// here, but the topic name is still exclusive to this surface
// (`portal-overview:<workspaceId>`) so it can never collide with another
// feature's channel for the same table.
import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";
import type { PortalRealtimeRow } from "@/lib/portal/reconcile-portal-realtime-task";

export type PortalOverviewRealtimeRow = PortalRealtimeRow & {
  title: string;
  project_id: string;
  due_date: string | null;
  updated_at: string;
  pending_client_approval: boolean | null;
};

export type PortalOverviewRealtimeEvent =
  RealtimePostgresChangesPayload<PortalOverviewRealtimeRow>;

export function subscribeToPortalOverviewRealtime(
  supabase: SupabaseClient,
  workspaceId: string,
  onChange: (event: PortalOverviewRealtimeEvent) => void,
): () => void {
  const topic = `portal-overview:${workspaceId}`;
  return acquireSharedTopicChannel<PortalOverviewRealtimeEvent>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
          },
          (payload: PortalOverviewRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
