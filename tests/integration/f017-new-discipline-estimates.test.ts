// F017 (missions/20260919-150607): integration tests proving the three
// disciplines F011 added to the unified WorkCategory vocabulary
// (content_seo, pm, qa) round-trip end to end through the real write path
// (setDisciplineEstimatesBulk, lib/actions/architecture/estimates.ts) and the
// real read path (getArchitectureNodeDetails,
// lib/queries/architecture-details.ts) against the linked Supabase
// project. Mirrors the loadDotEnv/vi.mock("@/lib/supabase/server")/
// describe.skipIf(!haveAdminCreds) pattern established by
// tests/integration/estimate-minutes-query-wiring.test.ts (F167 follow-up),
// the closest existing precedent for "seed via admin client, read via the
// real query/action layer, assert the shape."
//
// AS-060: a project member can write a task_discipline_estimates row for
//         discipline "content_seo" via setDisciplineEstimatesBulk and read it
//         back unchanged via getArchitectureNodeDetails.
// AS-061: the same round trip holds for discipline "pm".
// AS-062: the same round trip holds for discipline "qa".

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

// F065/F081 (missions/20260919-150607): `haveAdminCreds` only checks that
// env vars exist -- in a sandboxed/offline worker environment creds can be
// present but there is no network route to the project, and every test
// would fail with fetch-failed/ECONNREFUSED instead of skipping cleanly.
// This probes actual reachability (short-timeout HEAD against the auth
// health endpoint) so the suite skips in that environment and only runs
// for real where the project is genuinely reachable (CI with network
// access, or `supabase start`).
async function isSupabaseReachable(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(`${url}/auth/v1/health`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const canRunLive = haveAdminCreds && (await isSupabaseReachable(SUPABASE_URL));

let memberClient: SupabaseClient | null = null;

// setDisciplineEstimatesBulk/getArchitectureNodeDetails both call createClient()
// from lib/supabase/server (cookie-based, only valid inside a real Next.js
// request) via getCurrentUser() -- mocked the same way every other
// integration test in this suite mocks it, to a real signed-in supabase-js
// client instead.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

// F081 (missions/20260919-150607, AS-081): reverted to a conditional skip
// per the scrutiny report -- AS-081's atomicity guarantee (either every row
// in a bulk upsert lands or none do) cannot be proven by a unit test with a
// mocked client; it needs a real Postgres statement to fail mid-batch and a
// real re-read afterwards. Gated on `canRunLive` (creds present AND the
// project is actually reachable, see isSupabaseReachable above) so it skips
// cleanly in a sandboxed/offline worker environment and runs for real
// wherever the project can genuinely be reached.
describe.skipIf(!canRunLive)(
  "F017 — content_seo/pm/qa discipline estimates round-trip through write + read",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `f017-discipline-estimates-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";

      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create test user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F017 Discipline Estimates Workspace",
          slug: `f017-discipline-estimates-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "owner",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F017 Discipline Estimates Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F017 discipline estimate task",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to seed task: ${taskErr?.message}`);
      }
      taskId = task.id;

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    }, 30000);

    afterAll(async () => {
      if (taskId) {
        await adminClient.from("task_discipline_estimates").delete().eq("task_id", taskId);
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    }, 30000);

    it("test_AS_060_content_seo_estimate_writes_and_reads_back", async () => {
      const { setDisciplineEstimatesBulk } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimatesBulk(taskId, [
        { discipline: "content_seo", input: "1.5h", note: "content_seo note" },
      ]);
      expect(writeResult.success).toBe(true);

      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      const estimate = details?.estimates.find((e) => e.discipline === "content_seo");
      expect(estimate).toBeDefined();
      expect(estimate?.minutes).toBe(90);
      expect(estimate?.note).toBe("content_seo note");
    });

    it("test_AS_061_pm_estimate_writes_and_reads_back", async () => {
      const { setDisciplineEstimatesBulk } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimatesBulk(taskId, [
        { discipline: "pm", input: "45m", note: "pm note" },
      ]);
      expect(writeResult.success).toBe(true);

      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      const estimate = details?.estimates.find((e) => e.discipline === "pm");
      expect(estimate).toBeDefined();
      expect(estimate?.minutes).toBe(45);
      expect(estimate?.note).toBe("pm note");
    });

    it("test_AS_062_qa_estimate_writes_and_reads_back", async () => {
      const { setDisciplineEstimatesBulk } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimatesBulk(taskId, [
        { discipline: "qa", input: "2h", note: "qa note" },
      ]);
      expect(writeResult.success).toBe(true);

      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      const estimate = details?.estimates.find((e) => e.discipline === "qa");
      expect(estimate).toBeDefined();
      expect(estimate?.minutes).toBe(120);
      expect(estimate?.note).toBe("qa note");
    });

    it("test_AS_060_AS_061_AS_062_writing_one_discipline_does_not_mutate_another_disciplines_row_or_adjacent_meta_table", async () => {
      const { setDisciplineEstimatesBulk } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      // All three disciplines have already been written by the prior tests
      // in this file (content_seo=90, pm=45, qa=120). Writing a fresh value
      // for "qa" only must leave content_seo and pm untouched, and must not
      // create any architecture_node_meta row as a side effect.
      const writeResult = await setDisciplineEstimatesBulk(taskId, [
        { discipline: "qa", input: "10m", note: "qa updated" },
      ]);
      expect(writeResult.success).toBe(true);

      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      expect(details?.estimates.find((e) => e.discipline === "content_seo")?.minutes).toBe(90);
      expect(details?.estimates.find((e) => e.discipline === "pm")?.minutes).toBe(45);
      expect(details?.estimates.find((e) => e.discipline === "qa")?.minutes).toBe(10);
      expect(details?.meta).toBeNull();
    });

    it("test_AS_060_AS_061_AS_062_invalid_discipline_is_rejected_by_validation_before_any_write", async () => {
      const { setDisciplineEstimatesBulk } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimatesBulk(taskId, [
        { discipline: "not-a-real-discipline", input: "1h" },
      ]);
      expect(writeResult.success).toBe(false);

      // No row for the bogus discipline should have been written, and the
      // three real disciplines' values from the previous test are untouched.
      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      expect(
        details?.estimates.find(
          (e) => (e.discipline as string) === "not-a-real-discipline",
        ),
      ).toBeUndefined();
      expect(details?.estimates.length).toBe(3);
    });

    // AS-081 (F082, 5th/final attempt): setDisciplineEstimatesBulk writes
    // its whole batch through a single multi-row `upsert()` call
    // specifically so that Postgres's single-statement guarantee makes the
    // write all-or-nothing -- either every row in the batch lands, or none
    // do. F081's version of this test called the admin client's
    // `.upsert()` directly (bypassing the action entirely), which only
    // proved Postgres upserts are atomic in general -- not that *this
    // action's* call site is. Zod pre-validates every client-reachable bad
    // *value* (minutes must be a positive number), so a bad value can never
    // reach the DB through setDisciplineEstimatesBulk. But
    // setDisciplineEstimatesBulkSchema (lib/validation/architecture.ts)
    // does not dedupe `entries` by discipline, so a caller CAN legitimately
    // pass the same discipline twice in one batch. The action folds each
    // entry into a row keyed by (task_id, discipline) and upserts all rows
    // in one `.upsert(..., { onConflict: "task_id,discipline" })` call --
    // Postgres rejects a multi-row upsert that targets the same
    // ON CONFLICT key twice in a single statement ("ON CONFLICT DO UPDATE
    // command cannot affect row a second time"). That is a real,
    // Zod-legal-input-triggered, DB-level mid-batch failure reachable
    // through the action's actual public API -- proving the whole batch
    // (including the otherwise-valid "pm" row sharing the call) is rejected
    // atomically rather than partially applied.
    it("test_AS_081_failed_multi_row_upsert_leaves_all_existing_rows_unchanged", async () => {
      const { setDisciplineEstimatesBulk } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      // Seed known-good baseline values directly, independent of whatever
      // the earlier tests in this file left behind.
      const { error: seedError } = await adminClient.from("task_discipline_estimates").upsert(
        [
          {
            task_id: taskId,
            project_id: projectId,
            discipline: "pm",
            minutes: 45,
            note: "pm baseline",
            estimated_by: memberUserId,
          },
          {
            task_id: taskId,
            project_id: projectId,
            discipline: "qa",
            minutes: 120,
            note: "qa baseline",
            estimated_by: memberUserId,
          },
        ],
        { onConflict: "task_id,discipline" },
      );
      expect(seedError).toBeNull();

      // A batch that Zod fully accepts (every entry is a valid discipline
      // with a valid positive-minutes input) but that lists "qa" twice.
      // The otherwise-valid "pm" update rides along in the same batch --
      // if the write were not atomic, "pm" could land while "qa" fails.
      const writeResult = await setDisciplineEstimatesBulk(taskId, [
        { discipline: "pm", input: "99m", note: "pm should not land" },
        { discipline: "qa", input: "10m", note: "qa should not land (first)" },
        { discipline: "qa", input: "20m", note: "qa should not land (second)" },
      ]);

      expect(writeResult.success).toBe(false);

      // Re-read both rows through the real read path. Neither the valid
      // "pm" row nor the duplicated "qa" rows should have changed -- proving
      // the batch was rejected atomically by the action's real call site,
      // not partially applied.
      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      const pmEstimate = details?.estimates.find((e) => e.discipline === "pm");
      const qaEstimate = details?.estimates.find((e) => e.discipline === "qa");

      expect(pmEstimate?.minutes).toBe(45);
      expect(pmEstimate?.note).toBe("pm baseline");
      expect(qaEstimate?.minutes).toBe(120);
      expect(qaEstimate?.note).toBe("qa baseline");
    });
  },
);
