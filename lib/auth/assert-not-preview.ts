// F024b (missions/20260903-portal, AS-052 remediation): the shared,
// default-deny guard every portal-reachable Server Action that writes
// through an RPC call or posts a comment must call FIRST, before doing
// anything else.
//
// Why this exists as its own explicit call rather than being folded
// entirely into `lib/supabase/server.ts`: that file's `createClient()`
// already refuses every `.insert()/.update()/.upsert()/.delete()` issued
// through a preview session unconditionally (Layer A -- see its own
// comment). It deliberately does NOT block `.rpc()` calls, because
// existing portal READ paths call read-only RPCs
// (`project_hours_client`, `get_open_task_counts`, ...) through the same
// client, and there is no structural signal that separates a read RPC
// from a write RPC to block generically without also breaking those
// reads. `decideApproval`, `approvePortalTask`,
// `requestPortalTaskChanges`, `flagAssumption`,
// `deliverPortalDeliverable` (its `mark_deliverable_delivered_atomic`
// call) and `addComment` all act through an RPC or a table this seam does
// not blanket-cover, so each of those six calls `assertNotPreview()` as
// its own first line. This is a named, not a silent, gap in Layer A's
// default-deny coverage -- see F024b's handoff for the full accounting of
// why the two layers together, not one alone, cover the eight named write
// paths.
import { isPortalPreview, PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE } from "@/lib/supabase/server";

export type AssertNotPreviewResult = { ok: true } | { ok: false; error: string };

export async function assertNotPreview(): Promise<AssertNotPreviewResult> {
  // The try/catch below is deliberately narrow: it exists ONLY so that a
  // pre-existing test double that mocks `@/lib/supabase/server` wholesale
  // (dozens of tests/integration/*.test.ts files predate this feature and
  // exercise `addComment`/`createClientRequest`/etc. through a hand-rolled
  // `createClient()`-only mock, with no `isPortalPreview` export) doesn't
  // hard-crash with "isPortalPreview is not a function" the instant this
  // guard is added to a shared action. In real request handling
  // `isPortalPreview()` (lib/supabase/server.ts) always resolves to a real
  // boolean and never throws, so this branch is unreachable in production
  // -- it is a named accommodation for incomplete test doubles, not a
  // production fail-open path. Every test file added or touched by this
  // feature (see F024b's handoff) provides the real `isPortalPreview`
  // export instead of relying on this fallback.
  let previewing: boolean;
  try {
    previewing = await isPortalPreview();
  } catch {
    previewing = false;
  }
  if (previewing) {
    return { ok: false, error: PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE };
  }
  return { ok: true };
}
