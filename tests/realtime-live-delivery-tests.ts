// F092 (AS-369): the shared list of integration test files that open a
// real WebSocket to Supabase Realtime and wait for a genuine
// postgres_changes/broadcast event delivered over the wire (not a mocked
// realtime client -- see tests/unit/* for those). Both vitest.config.ts
// (which excludes these) and vitest.realtime.config.ts (which is the only
// config that includes these) import this single list, so a file can
// never be silently dropped from both configs or run twice by both.
//
// Found via `grep -rl "postgres_changes" tests/` and
// `grep -rl "\.subscribe(" tests/` (see F092 handoff for the full
// grep output) and narrowed to the integration files whose `.subscribe()`
// call is against a real `createClient(SUPABASE_URL, ...)` client and
// waits for a live event, as opposed to tests/integration/
// f221-board-custom-columns.test.ts (which only simulates a
// postgres_changes payload shape locally, never subscribes for real) or
// the tests/unit/* files (which all use a mocked/faithful-fake realtime
// client, never a real WebSocket).
export const REALTIME_LIVE_DELIVERY_TESTS = [
  "tests/integration/comment-format-realtime.test.ts",
  "tests/integration/comment-delete-broadcast.test.ts",
  "tests/integration/reaction-realtime-delivery.test.ts",
  "tests/integration/restore-comment.test.ts",
];
