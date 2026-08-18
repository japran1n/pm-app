// Integration test for F105 (AS-129, AS-134), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/dashboard-rls-cross-workspace.test.ts (F077's dedicated
// RPC parameter-tampering test).
//
// F077 already proved the three dashboard RPCs reject cross-workspace
// parameter tampering. `getWorkspaceListTasks` (lib/queries/tasks.ts,
// F078) reaches the same guarantee through a different mechanism — a
// direct `.eq("projects.workspace_id", workspaceId)` filter plus a
// `projects!inner` embed, relying on RLS (`is_project_workspace_member`)
// as the second layer rather than a SECURITY INVOKER RPC. That pattern is
// less common in this codebase than a straight RPC call and deserves its
// own explicit adversarial proof, per F105's spec note (a parallel M7
// scrutiny reviewer's finding): a member of workspace A calling
// getWorkspaceListTasks but passing workspace B's id directly as the
// `workspaceId` argument must get zero rows back, not workspace B's real
// data.
//
// Workspace B is seeded with real, non-trivial data (multiple tasks,
// multiple projects, multiple priorities/statuses) so a zero/empty result
// is proof the boundary holds, not just an artifact of workspace B having
// nothing to leak.
//
// This is a parameter-tampering test, not a UI test: the app itself would
// never construct a call like this (the workspace id always comes from
// the caller's own membership/URL param resolved server-side against
// their session), so this proves the boundary holds even if a
// compromised or malicious client invoked the query function directly
// with an arbitrary workspace id.

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

let memberOfAClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberOfAClient,
}));

describe.skipIf(!haveAdminCreds)(
  "getWorkspaceListTasks rejects cross-workspace parameter tampering (F105: AS-129, AS-134)",
  () => {
    let adminClient: SupabaseClient;
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
      const memberEmail = `f105-tamper-member-${uniqueSuffix}@example.com`;
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
          name: "F105 Workspace A",
          slug: `f105-ws-a-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B: the member is NOT part of this workspace. Seeded
      // with real data below so a zero/empty result is meaningful.
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F105 Workspace B (not a member)",
          slug: `f105-ws-b-${uniqueSuffix}`,
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

      // Workspace A gets a minimal project so the query has a valid,
      // in-scope target to compare against.
      const { error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F105 Workspace A Project" })
        .select("id")
        .single();
      if (projectAErr) {
        throw new Error(`Failed to seed project A: ${projectAErr.message}`);
      }

      const { data: projectB, error: projectBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "F105 Workspace B Project" })
        .select("id")
        .single();
      if (projectBErr || !projectB) {
        throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
      }
      projectBId = projectB.id;

      const seedTask = async (attrs: {
        title: string;
        status: string;
        priority: string;
      }) => {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectBId,
            title: attrs.title,
            status: attrs.status,
            priority: attrs.priority,
            author_id: memberAUserId,
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(`Failed to seed task "${attrs.title}": ${error?.message}`);
        }
        createdTaskIds.push(data.id);
      };

      // Workspace B is seeded with real, non-trivial data spanning
      // multiple statuses/priorities so getWorkspaceListTasks would
      // return non-empty results IF the workspace scoping were
      // bypassable. The attacker (member of A only) must still see
      // nothing.
      await seedTask({
        title: "F105 workspace B urgent task",
        status: "todo",
        priority: "urgent",
      });
      await seedTask({
        title: "F105 workspace B low task",
        status: "in_progress",
        priority: "low",
      });
      await seedTask({
        title: "F105 workspace B done task",
        status: "done",
        priority: "high",
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

    it("AS-129/AS-134: getWorkspaceListTasks called by a member of workspace A but passed workspace B's id directly returns zero rows, not workspace B's real tasks", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");

      // Workspace B genuinely has three tasks spanning todo/in_progress/
      // done and urgent/low/high — their absence here (not just a
      // filtered subset) proves the workspace scoping + RLS combination
      // blocks parameter tampering, not that workspace B was empty.
      const tasks = await getWorkspaceListTasks(workspaceBId);

      expect(tasks).toEqual([]);
    });
  },
);
