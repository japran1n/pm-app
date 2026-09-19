// F017 (missions/20260919-150607): integration tests proving the three
// disciplines F011 added to the unified WorkCategory vocabulary
// (content_seo, pm, qa) round-trip end to end through the real write path
// (setDisciplineEstimate, lib/actions/architecture/estimates.ts) and the
// real read path (getArchitectureNodeDetails,
// lib/queries/architecture-details.ts) against the linked Supabase
// project. Mirrors the loadDotEnv/vi.mock("@/lib/supabase/server")/
// describe.skipIf(!haveAdminCreds) pattern established by
// tests/integration/estimate-minutes-query-wiring.test.ts (F167 follow-up),
// the closest existing precedent for "seed via admin client, read via the
// real query/action layer, assert the shape."
//
// AS-060: a project member can write a task_discipline_estimates row for
//         discipline "content_seo" via setDisciplineEstimate and read it
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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F017: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

// setDisciplineEstimate/getArchitectureNodeDetails both call createClient()
// from lib/supabase/server (cookie-based, only valid inside a real Next.js
// request) via getCurrentUser() -- mocked the same way every other
// integration test in this suite mocks it, to a real signed-in supabase-js
// client instead.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
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
      const { setDisciplineEstimate } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimate(
        taskId,
        "content_seo",
        "1.5h",
        "content_seo note",
      );
      expect(writeResult.success).toBe(true);

      const readResult = await getArchitectureNodeDetails(projectId);
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const details = readResult.data.get(taskId);
      const estimate = details?.estimates.find((e) => e.discipline === "content_seo");
      expect(estimate).toBeDefined();
      expect(estimate?.minutes).toBe(90);
      expect(estimate?.note).toBe("content_seo note");
      expect(estimate?.estimatedBy).toBe(memberUserId);
    });

    it("test_AS_061_pm_estimate_writes_and_reads_back", async () => {
      const { setDisciplineEstimate } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimate(taskId, "pm", "45m", "pm note");
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
      const { setDisciplineEstimate } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimate(taskId, "qa", "2h", "qa note");
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
      const { setDisciplineEstimate } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      // All three disciplines have already been written by the prior tests
      // in this file (content_seo=90, pm=45, qa=120). Writing a fresh value
      // for "qa" only must leave content_seo and pm untouched, and must not
      // create any architecture_node_meta row as a side effect.
      const writeResult = await setDisciplineEstimate(taskId, "qa", "10m", "qa updated");
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
      const { setDisciplineEstimate } = await import("@/lib/actions/architecture/estimates");
      const { getArchitectureNodeDetails } = await import("@/lib/queries/architecture-details");

      const writeResult = await setDisciplineEstimate(taskId, "not-a-real-discipline", "1h");
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
  },
);
