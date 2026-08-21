// Integration test for F077 (AS-133), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/search-tasks.test.ts and the sibling F071/F072/F075
// tests (priority-counts-rpc.test.ts, status-counts-rpc.test.ts,
// overdue-count-rpc.test.ts).
//
// AS-133: "A member of workspace A querying dashboard aggregates cannot
// retrieve counts that include workspace B's tasks via direct API
// manipulation."
//
// The three dashboard RPCs (get_priority_counts, get_status_counts,
// get_overdue_count — supabase/migrations/20260818054815_rpc_priority_counts.sql,
// supabase/migrations/20260818070000_rpc_status_counts.sql,
// supabase/migrations/20260818080000_rpc_overdue_count.sql) already each
// carry an individual "RLS-enforced" negative test proving a non-member
// gets zero/empty results for a workspace they don't belong to. This file
// is the dedicated F077 adversarial test: it consolidates that same
// attack — a member of workspace A calling every dashboard RPC and
// passing workspace B's id directly as p_workspace_id — against a
// workspace B that is seeded with REAL, non-trivial data (multiple
// priorities, multiple statuses, and a genuinely overdue task) so a
// zero/empty result is proof the RLS + SECURITY INVOKER combination
// blocks parameter tampering, not just an artifact of workspace B having
// no rows to leak in the first place.
//
// This is a parameter-tampering test, not a UI test: the app itself would
// never construct a call like this (the active workspace id always comes
// from the caller's own membership), so this proves the boundary holds
// even if a compromised or malicious client called the RPC directly with
// an arbitrary workspace id.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!haveAdminCreds)(
  "dashboard RPCs reject cross-workspace parameter tampering (F077: AS-133)",
  () => {
    let adminClient: SupabaseClient;
    let memberOfAClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectBId: string;
    let memberAUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Member belongs ONLY to workspace A.
      const memberEmail = `f077-tamper-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create test user: ${memberAuthErr?.message}`,
        );
      }
      memberAUserId = memberAuth.user.id;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F077 Workspace A",
          slug: `f077-ws-a-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B: the member is NOT part of this workspace. Seeded with
      // real data below so a zero/empty result is meaningful.
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F077 Workspace B (not a member)",
          slug: `f077-ws-b-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceAId,
          user_id: memberAUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed membership: ${memberErr.message}`);
      }

      // Workspace A gets a minimal project so the RPC has a valid,
      // in-scope target to compare against.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F077 Workspace A Project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }

      const { data: projectB, error: projectBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "F077 Workspace B Project" })
        .select("id")
        .single();
      if (projectBErr || !projectB) {
        throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
      }
      projectBId = projectB.id;

      const pastDate = isoDateOffset(-5);

      const seedTask = async (attrs: {
        project_id: string;
        title: string;
        status: string;
        priority: string;
        due_date?: string | null;
      }) => {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: attrs.project_id,
            title: attrs.title,
            status: attrs.status,
            priority: attrs.priority,
            author_id: memberAUserId,
            due_date: attrs.due_date ?? null,
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(`Failed to seed task "${attrs.title}": ${error?.message}`);
        }
        createdTaskIds.push(data.id);
      };

      // Workspace B is seeded with real, non-trivial data spanning
      // multiple priorities, multiple statuses, and one genuinely overdue
      // task — so that get_priority_counts / get_status_counts /
      // get_overdue_count would all return non-zero, non-empty results IF
      // the RLS boundary were bypassable. The attacker (member of A only)
      // must still see nothing.
      await seedTask({
        project_id: projectBId,
        title: "F077 workspace B urgent task",
        status: "todo",
        priority: "urgent",
      });
      await seedTask({
        project_id: projectBId,
        title: "F077 workspace B low task",
        status: "in_progress",
        priority: "low",
      });
      await seedTask({
        project_id: projectBId,
        title: "F077 workspace B overdue task",
        status: "todo",
        priority: "high",
        due_date: pastDate,
      });

      memberOfAClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberOfAClient.auth.signInWithPassword(
        {
          email: memberEmail,
          password: memberPassword,
        },
      );
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      await adminClient.from("projects").delete().eq("workspace_id", workspaceAId);
      await adminClient.from("projects").delete().eq("workspace_id", workspaceBId);
      for (const id of [workspaceAId, workspaceBId]) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      if (memberAUserId) await adminClient.auth.admin.deleteUser(memberAUserId);
    });

    it("AS-133: get_priority_counts called with workspace B's id (direct parameter tampering) returns no rows, not workspace B's real priority data", async () => {
      const { data, error } = await memberOfAClient.rpc("get_priority_counts", {
        p_workspace_id: workspaceBId,
      });

      expect(error).toBeNull();
      // Workspace B genuinely has an 'urgent' and a 'low' priority task —
      // their absence here (not just a filtered subset) proves RLS blocked
      // the join entirely rather than the app happening not to ask.
      expect(data ?? []).toEqual([]);
    });

    it("AS-133: get_status_counts called with workspace B's id (direct parameter tampering) returns no rows, not workspace B's real status data", async () => {
      const { data, error } = await memberOfAClient.rpc("get_status_counts", {
        p_workspace_id: workspaceBId,
      });

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("AS-133: get_overdue_count called with workspace B's id (direct parameter tampering) returns 0, not workspace B's real overdue count", async () => {
      const { data, error } = await memberOfAClient.rpc("get_overdue_count", {
        p_workspace_id: workspaceBId,
      });

      expect(error).toBeNull();
      // Workspace B has one genuinely overdue task — a non-zero count here
      // would mean the RPC's p_workspace_id parameter was trusted instead
      // of being re-checked by RLS against the caller's actual membership.
      expect(Number(data)).toBe(0);
    });

    it("sanity check: the same member CAN read workspace A's own (empty) aggregates without error, proving the RPCs work at all for legitimate calls", async () => {
      const { data: priorityData, error: priorityErr } =
        await memberOfAClient.rpc("get_priority_counts", {
          p_workspace_id: workspaceAId,
        });
      expect(priorityErr).toBeNull();
      expect(priorityData ?? []).toEqual([]);

      const { data: overdueData, error: overdueErr } = await memberOfAClient.rpc(
        "get_overdue_count",
        { p_workspace_id: workspaceAId },
      );
      expect(overdueErr).toBeNull();
      expect(Number(overdueData)).toBe(0);
    });
  },
);
