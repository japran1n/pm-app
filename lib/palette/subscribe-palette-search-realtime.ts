// F012 (AS-023, AS-024): Realtime wiring for the command palette's search
// results, mirroring the pattern established by
// lib/board/subscribe-board-realtime.ts — a plain, React-free function so
// the channel configuration is unit-testable without a DOM/React runtime
// (this repo's vitest config runs with environment: "node").
//
// Workspace-scoped topic (`tasks:${workspaceId}`) rather than per-project,
// since the palette searches across every project in the workspace the
// caller can see (lib/actions/palette-search.ts). Uses the shared,
// ref-counted channel helper (lib/realtime/shared-topic-channel.ts) so a
// second subscriber to the same `tasks:<workspaceId>` topic (e.g. another
// component also watching workspace-wide task changes) never double-calls
// `.on()`/`.subscribe()` on an already-joined channel.
//
// F081 audit: this `postgres_changes` binding has NO row filter and, on
// paper, that is the same shape that made
// tests/integration/reaction-realtime-delivery.test.ts fail for weeks. It
// is left unfiltered here deliberately, not by omission, for a reason a
// filter on `board`/`portal task-list`'s pattern (`project_id=eq.<id>`)
// doesn't have available: the palette's whole job is to search across
// EVERY project in the workspace (lib/actions/palette-search.ts), and
// `tasks` carries no `workspace_id` column (only `project_id`, joined
// through `projects` -- confirmed via
// supabase/migrations/20260818013434_create_tasks.sql and every later
// `alter table tasks` migration; grep found none adding one) -- so there is
// no equality filter Realtime's row-filter syntax can express here that
// wouldn't also drop legitimate cross-project matches. Filtering on
// `assignee_id=eq.<userId>` (the other option this audit raised) was
// rejected for the same reason: the palette returns title/key matches
// regardless of assignee (see PaletteRealtimeTaskRow/reconcile-palette-
// search-results.ts, which never look at assignee), so that filter would
// silently make live updates stop arriving for the majority of a caller's
// own search results -- a regression, not a fix.
//
// What this file DOES do about cost, and what it does not additionally
// need to do: the channel is only ever opened while there is an actual,
// non-empty query to reconcile against
// (lib/hooks/use-palette-search-realtime.ts's `if (!workspaceId ||
// query.length === 0) return;` guard) -- and every path that closes the
// command palette (components/command/command-palette.tsx's
// `resetPaletteState`, called from Radix's `onOpenChange`, the Cmd+K
// toggle, and `navigate`) clears `query` back to `""`, tearing the
// subscription down again. So this is already the "only subscribe while
// the palette is actually open [and searching]" mitigation the audit
// raised as a minimum -- it is NOT held open for a caller's whole session
// the way the file only being imported into the always-mounted app shell
// might suggest at a glance. It is also a single, ref-counted channel per
// workspace (not per open palette), so N callers concurrently searching
// the same workspace share one underlying Realtime subscription, not N.

import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type PaletteRealtimeTaskRow = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  deleted_at?: string | null;
};

export type PaletteRealtimeEvent =
  RealtimePostgresChangesPayload<PaletteRealtimeTaskRow>;

export function subscribeToPaletteSearchRealtime(
  supabase: SupabaseClient,
  workspaceId: string,
  onChange: (event: PaletteRealtimeEvent) => void,
): () => void {
  const topic = `tasks:${workspaceId}`;
  return acquireSharedTopicChannel<PaletteRealtimeEvent>(
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
          (payload: PaletteRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
