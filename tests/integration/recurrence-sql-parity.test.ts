// F178: proves the SQL date-math function
// (`public.recurrence_next_due_date`, added by
// supabase/migrations/20260822160000_recurrence_scheduled_generation.sql)
// implements the SAME rules as F176's TypeScript
// `lib/recurrence/next-date.ts` (`nextOccurrenceDate`) — this is the
// feature spec's actual verification bar ("write a test running
// representative cases through BOTH implementations, asserting matching
// output"), not just "the SQL looks similar."
//
// Runs against the real linked Supabase project (the function is pure/
// immutable, so calling it via `.rpc(...)` has no side effects and no
// seeded rows are needed) — mirrors the loadDotEnv/skipIf/admin-client
// pattern this mission's other F175-F178 integration suites already use.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  nextOccurrenceDate,
  type RecurrenceRule,
} from "@/lib/recurrence/next-date";

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F178: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// `timezone` doesn't affect nextOccurrenceDate's day-count arithmetic
// itself (see next-date.ts's own top comment) — a fixed valid IANA zone
// is used for every TypeScript-side call so both implementations are
// compared on the exact same date-only arithmetic.
const TZ = "UTC";

// Representative cases covering: daily/weekly/monthly/every_n_days, an
// interval > 1, month-end clamping (non-leap Feb, leap Feb, 31->30-day
// month), an inclusive `until` boundary (exactly equal — still valid),
// an exclusive `until` boundary (one day past — null), and no `until` at
// all.
const CASES: Array<{ label: string; rule: RecurrenceRule; from: string }> = [
  { label: "daily, interval 1", rule: { freq: "daily", interval: 1 }, from: "2026-09-01" },
  { label: "daily, interval 5", rule: { freq: "daily", interval: 5 }, from: "2026-09-01" },
  { label: "weekly, interval 1", rule: { freq: "weekly", interval: 1 }, from: "2026-09-01" },
  { label: "weekly, interval 3", rule: { freq: "weekly", interval: 3 }, from: "2026-09-01" },
  { label: "every_n_days, interval 10", rule: { freq: "every_n_days", interval: 10 }, from: "2026-09-01" },
  { label: "monthly, interval 1, mid-month", rule: { freq: "monthly", interval: 1 }, from: "2026-09-15" },
  { label: "monthly, interval 1, Jan 31 -> Feb 28 (non-leap)", rule: { freq: "monthly", interval: 1 }, from: "2027-01-31" },
  { label: "monthly, interval 1, Jan 31 -> Feb 29 (leap)", rule: { freq: "monthly", interval: 1 }, from: "2028-01-31" },
  { label: "monthly, interval 1, May 31 -> Jun 30", rule: { freq: "monthly", interval: 1 }, from: "2026-05-31" },
  { label: "monthly, interval 2", rule: { freq: "monthly", interval: 2 }, from: "2026-03-31" },
  { label: "daily, until exactly equal to computed next (inclusive)", rule: { freq: "daily", interval: 1, until: "2026-09-02" }, from: "2026-09-01" },
  { label: "daily, until one day before computed next (exclusive, exhausted)", rule: { freq: "daily", interval: 1, until: "2026-09-01" }, from: "2026-09-01" },
  { label: "daily, until far in the future (unaffected)", rule: { freq: "daily", interval: 1, until: "2030-01-01" }, from: "2026-09-01" },
  { label: "daily, no until at all", rule: { freq: "daily", interval: 1 }, from: "2026-09-01" },
];

describe.skipIf(!haveAdminCreds)(
  "SQL/TypeScript date-math parity (F178)",
  () => {
    let adminClient: SupabaseClient;

    beforeAll(() => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    it.each(CASES)(
      "matches for: $label",
      async ({ rule, from }) => {
        const tsResult = nextOccurrenceDate(rule, from, TZ);

        const { data: sqlResult, error } = await adminClient.rpc(
          "recurrence_next_due_date",
          { p_rule: rule, p_from_date: from },
        );
        expect(error).toBeNull();

        expect(sqlResult ?? null).toBe(tsResult);
      },
    );

    it("matches on invalid input: unsupported freq -> both null", async () => {
      const rule = { freq: "yearly", interval: 1 } as unknown as RecurrenceRule;
      const tsResult = nextOccurrenceDate(rule, "2026-09-01", TZ);

      const { data: sqlResult, error } = await adminClient.rpc(
        "recurrence_next_due_date",
        { p_rule: rule, p_from_date: "2026-09-01" },
      );
      expect(error).toBeNull();
      expect(tsResult).toBeNull();
      expect(sqlResult ?? null).toBeNull();
    });

    it("matches on invalid input: zero interval -> both null", async () => {
      const rule = { freq: "daily", interval: 0 } as RecurrenceRule;
      const tsResult = nextOccurrenceDate(rule, "2026-09-01", TZ);

      const { data: sqlResult, error } = await adminClient.rpc(
        "recurrence_next_due_date",
        { p_rule: rule, p_from_date: "2026-09-01" },
      );
      expect(error).toBeNull();
      expect(tsResult).toBeNull();
      expect(sqlResult ?? null).toBeNull();
    });
  },
);
