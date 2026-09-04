// F103 (AS-369): capability guard for the local Supabase CLI stack's known
// limitation delivering `postgres_changes` on REPLICA IDENTITY FULL tables.
//
// Where this came from: CI run 33910074156's F102 diagnostic (a scratch
// FULL-identity table's *first-ever* postgres_changes subscription on a
// fresh client) never received its INSERT within 20s, while a sibling
// scratch DEFAULT-identity table subscribed immediately afterward on the
// SAME client received its INSERT in 107ms. That pattern repeats across
// this test file's own two `it` blocks in every CI run inspected
// (33903580222, 33905606959, 33907896942, 33910074156): the file's first
// `it` -- the first postgres_changes subscription this file's
// `subscriberClient` ever opens, against comment_reactions (REPLICA
// IDENTITY FULL) -- times out at 45s in three of those four runs and
// succeeded in 515ms in the fourth (33910074156); the file's second `it`
// -- a second, warm postgres_changes subscription against the same FULL
// table -- reliably receives its event in under a second in every run,
// including the three where the first `it` timed out.
//
// That reconciliation matters: it means the honest characterization is not
// "REPLICA IDENTITY FULL never delivers on this stack" (comment_reactions
// IS FULL, and the file's second test proves it delivers, repeatedly, in
// the very same runs) -- it is "a table's FIRST-EVER postgres_changes
// subscription on this stack sometimes needs longer than any budget this
// investigation has used, and F102's own experiment design (FULL probed
// first, DEFAULT probed second, sequentially on one client) cannot
// distinguish 'FULL' from 'first subscription' as the cause, because it
// never varied the two independently. See the F103 handoff for the full
// trail and the recommended follow-up (swap probe order) that would
// separate these two variables for good.
//
// This probe does not try to resolve that ambiguity -- it reproduces
// AS-369's first `it` block's exact condition (a brand-new client's first
// postgres_changes subscription, against a REPLICA IDENTITY FULL table)
// and reports whether that condition delivers right now, on whatever stack
// this test run is executing against. That is the only thing the calling
// test needs to know, regardless of which of the two variables (or both)
// turns out to be the true cause.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ReplicaIdentityProbeResult {
  capable: boolean;
  elapsedMs: number | null;
}

// F096 measured real, working postgres_changes deliveries (DEFAULT
// identity, hosted project) at 464-671ms; F102's own DEFAULT-identity
// scratch probe measured 107ms locally. 8000ms is ~12-75x that -- generous
// headroom for a first-subscription connection handshake plus delivery on
// a loaded CI runner, while stopping well short of F102's old 20000ms (this
// guard runs on every CI invocation of this suite, not as a one-off
// diagnostic, so its own budget should not be the slowest thing in the job).
const PROBE_CEILING_MS = 8000;

const PROBE_TABLE = "_realtime_capability_probe";

/**
 * Opens a brand-new client connection (so its postgres_changes
 * subscription is guaranteed to be that connection's first, matching
 * AS-369's own first `it` block) and measures whether an INSERT into the
 * permanent, REPLICA IDENTITY FULL `_realtime_capability_probe` table
 * (see supabase/migrations/20261030010000_f103_realtime_capability_probe_
 * table.sql) is delivered within PROBE_CEILING_MS.
 *
 * `adminClient` is used only to perform the INSERT and the cleanup DELETE
 * -- the connection under test is a fresh one created internally, never
 * reused across calls, so repeated calls each pay (and each measure) a
 * genuinely cold first subscription.
 */
export async function probeReplicaIdentityFullDelivery(
  supabaseUrl: string,
  secretKey: string,
  adminClient: SupabaseClient,
): Promise<ReplicaIdentityProbeResult> {
  const probeClient: SupabaseClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tag = `f103-capability-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const result = await new Promise<ReplicaIdentityProbeResult>((resolve) => {
      const t0 = Date.now();
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ capable: false, elapsedMs: null });
      }, PROBE_CEILING_MS);

      const channel = probeClient
        .channel(`f103-capability-probe-${tag}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: PROBE_TABLE, filter: `tag=eq.${tag}` },
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ capable: true, elapsedMs: Date.now() - t0 });
          },
        )
        .subscribe(async (status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ capable: false, elapsedMs: null });
            return;
          }
          if (status === "SUBSCRIBED") {
            await adminClient.from(PROBE_TABLE).insert({ tag });
          }
        });

      // Best-effort cleanup of the channel once this promise settles --
      // not awaited, this function's caller doesn't need to wait on it.
      void (async () => {
        await new Promise((r) => setTimeout(r, PROBE_CEILING_MS + 500));
        await probeClient.removeChannel(channel);
      })();
    });

    return result;
  } finally {
    await adminClient.from(PROBE_TABLE).delete().eq("tag", tag);
    void probeClient.removeAllChannels();
  }
}
