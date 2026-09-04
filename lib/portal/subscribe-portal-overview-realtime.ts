// F008 (AS-018, AS-019, AS-020, AS-024): the actual Realtime channel setup
// for the client portal overview's "Waiting on you" region, extracted as a
// plain function so it's testable without a React runtime/DOM — same
// rationale as lib/board/subscribe-board-realtime.ts (F049): this repo's
// vitest config runs with `environment: "node"`, so logic buried inside a
// `useEffect` would be unverifiable without a browser-like test
// environment. The hook (use-portal-overview-realtime.ts) is a thin
// wrapper: call this in an effect, return the unsubscribe it gives back.
//
// F081: this component is mounted in two shapes (see
// components/portal/portal-overview-live.tsx) -- the multi-project
// workspace chooser page (no single project to scope to) and the
// per-project portal shell (`projectId` known). The `tasks` table has no
// `workspace_id` column (only `project_id`, joined through `projects`), so
// there is no equality filter that can scope the workspace-chooser case
// server-side; that path is left genuinely unfiltered and correctness
// there still comes from Realtime re-applying the table's RLS SELECT
// policy before broadcasting -- the same pattern
// components/my-tasks/use-my-tasks-realtime.ts uses for its own
// workspace-wide (not single-project) subscription. But when `projectId`
// IS known (the common case -- every per-project portal page), there is no
// reason to make Realtime RLS-recheck and ship every OTHER project's task
// writes in the whole Supabase project to this client just to have them
// discarded by the `pending_client_approval`/project-match predicate in
// lib/portal/reconcile-portal-realtime-task.ts (F007) -- so that case gets
// a real `project_id=eq.<projectId>` filter, matching the pattern proven at
// lib/board/subscribe-board-realtime.ts.
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
  // F081: when set, scopes the Realtime row filter (and the channel topic,
  // so a project-scoped subscriber never shares -- and therefore never
  // silently inherits the filter of -- a differently-scoped subscriber's
  // already-open channel for the same workspace) to this one project.
  // `undefined`/omitted keeps the pre-existing workspace-wide, unfiltered
  // behaviour the multi-project chooser page genuinely needs (see this
  // file's header comment for why that case cannot be filtered).
  projectId?: string,
): () => void {
  const topic = projectId
    ? `portal-overview:${workspaceId}:${projectId}`
    : `portal-overview:${workspaceId}`;
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
            ...(projectId ? { filter: `project_id=eq.${projectId}` } : {}),
          },
          (payload: PortalOverviewRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
