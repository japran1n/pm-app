#!/usr/bin/env node
// check-cron-health.mjs — P2-21: manual / scheduled pg_cron health check
//
// Queries `cron.job_run_details` for the last run of every pg_cron job
// defined in this project's migrations and prints a table of job name, last
// run time, status, and return message. Exits with code 1 if any job:
//   • has never run, OR
//   • has not completed a successful run in the last 25 hours (for
//     hourly/daily jobs the acceptable window is 25 h, giving a 1-hour
//     grace beyond the longest expected gap between successful runs).
//
// Usage (requires .env or the two env vars set in the shell):
//   node scripts/check-cron-health.mjs
//
// Required env vars (same ones the supabase CLI uses):
//   SUPABASE_PROJECT_REF   — e.g. "xyzabcdef" (the ref from your project URL)
//   SUPABASE_ACCESS_TOKEN  — a personal access token from supabase.com/dashboard
//
// Or, for projects that expose the DATABASE_URL / DIRECT_URL instead, see
// the "Alternative: direct Postgres" section below.
//
// Where to call this script:
//   Add a step in .github/workflows/ci.yml under a `schedule:` trigger or
//   an on-demand `workflow_dispatch:`. Example:
//
//     - name: Check pg_cron job health
//       run: node scripts/check-cron-health.mjs
//       env:
//         SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
//         SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
//
// The script is intentionally dependency-free (Node built-ins + fetch, which
// is available in Node 18+).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Catalog: one entry per cron.schedule() call in supabase/migrations/.
// Keep this in sync with the migrations that call cron.schedule().
// ---------------------------------------------------------------------------
const EXPECTED_JOBS = [
  {
    jobname: "generate-due-recurring-occurrences",
    schedule: "0 * * * *",
    migration: "20260822160000_recurrence_scheduled_generation.sql",
  },
  {
    jobname: "notify-overdue-task-assignees",
    schedule: "0 * * * *",
    migration: "20260823050000_overdue_notification_sweep.sql",
  },
  {
    jobname: "sweep-overdue-blocking-deliverables",
    schedule: "0 * * * *",
    migration: "20260927010000_f013_deliverables_review_and_blocking_sweep.sql",
  },
  {
    jobname: "sweep-project-budget-thresholds",
    schedule: "30 6 * * *",
    migration: "20261012010000_f018_budget_threshold_sweep.sql",
  },
];

// How many hours back to look for a successful run before flagging a job as
// unhealthy. 25 h covers any job whose longest expected inter-run gap is 24 h
// (the daily budget-threshold sweep) with a 1-hour grace margin.
const HEALTHY_WINDOW_HOURS = 25;

// ---------------------------------------------------------------------------
// .env loader (mirrors the one in overdue-notification-sweep.test.ts).
// ---------------------------------------------------------------------------
function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error(
    "ERROR: SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set.\n" +
      "       Add them to your .env file or export them in the shell before running this script.\n" +
      "\n" +
      "Alternative: direct Postgres\n" +
      "  If you have a DATABASE_URL / DIRECT_URL pointing at the project's\n" +
      "  Postgres server you can query cron.job and cron.job_run_details\n" +
      "  directly using psql or a Node Postgres client:\n" +
      "    SELECT jobname, schedule, active FROM cron.job;\n" +
      "    SELECT jobid, start_time, end_time, status, return_message\n" +
      "      FROM cron.job_run_details\n" +
      "      WHERE jobid = <id> ORDER BY start_time DESC LIMIT 10;\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase Management API SQL helper (same approach as the test suite).
// ---------------------------------------------------------------------------
async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `SQL query failed (${res.status}): ${JSON.stringify(body)}\nQuery: ${query}`,
    );
  }
  return body;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("pg_cron job health check\n");

  // 1. Verify all expected jobs are registered.
  const jobnames = EXPECTED_JOBS.map((j) => `'${j.jobname}'`).join(", ");
  const registeredRows = await sql(`
    SELECT jobid, jobname, schedule, active
    FROM cron.job
    WHERE jobname IN (${jobnames})
    ORDER BY jobname;
  `);

  const registeredByName = Object.fromEntries(
    registeredRows.map((r) => [r.jobname, r]),
  );

  let anyUnhealthy = false;

  // 2. For each expected job, fetch the most recent successful run.
  const cutoff = new Date(Date.now() - HEALTHY_WINDOW_HOURS * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  const rows = [];

  for (const expected of EXPECTED_JOBS) {
    const registered = registeredByName[expected.jobname];

    if (!registered) {
      rows.push({
        jobname: expected.jobname,
        schedule: expected.schedule,
        lastRun: "MISSING",
        status: "NOT REGISTERED",
        healthy: false,
      });
      anyUnhealthy = true;
      continue;
    }

    if (!registered.active) {
      rows.push({
        jobname: expected.jobname,
        schedule: registered.schedule,
        lastRun: "—",
        status: "INACTIVE",
        healthy: false,
      });
      anyUnhealthy = true;
      continue;
    }

    // Fetch the last successful run within the healthy window.
    const runRows = await sql(`
      SELECT start_time, end_time, status, return_message
      FROM cron.job_run_details
      WHERE jobid = ${registered.jobid}
        AND status = 'succeeded'
      ORDER BY start_time DESC
      LIMIT 1;
    `);

    if (runRows.length === 0) {
      rows.push({
        jobname: expected.jobname,
        schedule: registered.schedule,
        lastRun: "never",
        status: "NO SUCCESSFUL RUN",
        healthy: false,
      });
      anyUnhealthy = true;
      continue;
    }

    const lastRun = runRows[0];
    const lastRunTime = new Date(lastRun.start_time);
    const isHealthy = lastRunTime >= cutoff;

    if (!isHealthy) anyUnhealthy = true;

    rows.push({
      jobname: expected.jobname,
      schedule: registered.schedule,
      lastRun: lastRun.start_time,
      status: isHealthy ? "OK" : `STALE (last ok: ${lastRun.start_time})`,
      healthy: isHealthy,
    });
  }

  // 3. Print results table.
  const colWidths = {
    jobname: Math.max(7, ...rows.map((r) => r.jobname.length)),
    schedule: Math.max(8, ...rows.map((r) => r.schedule.length)),
    lastRun: Math.max(8, ...rows.map((r) => String(r.lastRun).length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
  };

  const header = [
    "JOB NAME".padEnd(colWidths.jobname),
    "SCHEDULE".padEnd(colWidths.schedule),
    "LAST RUN".padEnd(colWidths.lastRun),
    "STATUS".padEnd(colWidths.status),
  ].join("  ");

  const divider = "-".repeat(header.length);

  console.log(header);
  console.log(divider);

  for (const row of rows) {
    const icon = row.healthy ? "✓" : "✗";
    console.log(
      [
        row.jobname.padEnd(colWidths.jobname),
        row.schedule.padEnd(colWidths.schedule),
        String(row.lastRun).padEnd(colWidths.lastRun),
        `${icon} ${row.status}`,
      ].join("  "),
    );
  }

  console.log("");

  if (anyUnhealthy) {
    console.error(
      `ERROR: One or more pg_cron jobs are unhealthy (see rows marked ✗ above).\n` +
        `       Check the Supabase dashboard → Database → Cron Jobs for details.`,
    );
    process.exit(1);
  }

  console.log(`All ${rows.length} pg_cron jobs are healthy.`);
}

main().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  process.exit(1);
});
