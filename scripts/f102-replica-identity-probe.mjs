// F102 (AS-369): isolates REPLICA IDENTITY as the sole variable in a
// controlled, single-CI-run experiment, to distinguish the two remaining
// hypotheses left by F099/F101:
//
//   1. FULL blocks postgres_changes delivery on this stack (local-stack
//      limitation, comment_reactions itself is fine) -- REPLICA IDENTITY
//      FULL is the one confirmed schema-level difference between
//      `comments` (whose sibling test passes) and `comment_reactions`
//      (whose test times out), per F099's diagnostic dump.
//   2. FULL is irrelevant and delivery still fails for some other reason
//      -- in which case the next thing to look at is NOT replica identity.
//
// Design: two throwaway scratch tables, identical in every respect except
// replica identity (`f102_probe_full` = FULL, `f102_probe_default` =
// DEFAULT), both added to the `supabase_realtime` publication by the CI
// step that invokes this script (see .github/workflows/ci.yml, "F102:
// replica identity delivery experiment"). This script subscribes to an
// unfiltered postgres_changes INSERT on both (service-role client, so RLS
// is not a variable), inserts one row into each, and logs whether/when
// each delivers. It does not touch `comment_reactions` at all -- the
// scratch tables are dropped by the same CI step immediately after this
// script exits, so no schema change to any product table is possible from
// this experiment, and nothing needs to be "restored".
//
// This script's own exit code is always 0 -- it is a diagnostic, not a
// gate; the CI step's log output is the evidence, read by a human/worker
// afterward, same as F099's publication-state dump.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const CEILING_MS = 20000;

function subscribeAndInsert(client, table, label) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let received = false;

    const timeout = setTimeout(() => {
      if (received) return;
      process.stderr.write(
        `[F102][${label}] ${table}: postgres_changes INSERT NOT received within ${CEILING_MS}ms (elapsed ${Date.now() - t0}ms)\n`,
      );
      resolve({ table, label, received: false, elapsedMs: null });
    }, CEILING_MS);

    const channel = client
      .channel(`f102-probe-${table}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        () => {
          if (received) return;
          received = true;
          clearTimeout(timeout);
          const elapsed = Date.now() - t0;
          process.stderr.write(
            `[F102][${label}] ${table}: postgres_changes INSERT received ${elapsed}ms after SUBSCRIBED\n`,
          );
          void client.removeChannel(channel);
          resolve({ table, label, received: true, elapsedMs: elapsed });
        },
      )
      .subscribe(async (status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          process.stderr.write(
            `[F102][${label}] ${table}: subscribe failed: ${status} ${err?.message ?? ""}\n`,
          );
          resolve({ table, label, received: false, elapsedMs: null });
          return;
        }
        if (status === "SUBSCRIBED") {
          const { error: insertErr } = await client
            .from(table)
            .insert({ tag: `f102-${label}` });
          if (insertErr) {
            process.stderr.write(
              `[F102][${label}] ${table}: insert failed: ${insertErr.message}\n`,
            );
          }
        }
      });
  });
}

async function main() {
  if (!SUPABASE_URL || !SECRET_KEY) {
    process.stderr.write(
      "[F102] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY -- cannot run the replica-identity probe\n",
    );
    process.exit(0);
  }

  const client = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Sequential, not parallel: keeps each probe's own SUBSCRIBED->insert
  // timing uncontended by the other probe's channel handshake, same
  // reasoning as F074's warmup in reaction-realtime-delivery.test.ts.
  const fullResult = await subscribeAndInsert(
    client,
    "f102_probe_full",
    "REPLICA IDENTITY FULL",
  );
  const defaultResult = await subscribeAndInsert(
    client,
    "f102_probe_default",
    "REPLICA IDENTITY DEFAULT",
  );

  process.stderr.write(
    `[F102] summary: FULL received=${fullResult.received} defaultReceived=${defaultResult.received}\n`,
  );

  process.exit(0);
}

main();
