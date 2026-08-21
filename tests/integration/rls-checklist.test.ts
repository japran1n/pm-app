// Integration test for F151 `checklist_items` schema + RLS (AS-269,
// AS-274).
//
// Verifies against the real linked Supabase project that:
//  - a task can have checklist items with text (`content`) and a checked
//    state (`is_checked`), and that state persists as written (AS-269)
//  - a member of the workspace that owns the checklist item's task (via
//    task -> project -> workspace) can SELECT/INSERT checklist items on
//    that task
//  - a signed-in user who is NOT a member of that workspace cannot view a
//    checklist item belonging to it, including via a join-style query on
//    task_id, and cannot insert one claiming that task_id (AS-274)
//  - the anon/publishable key with no session reading `checklist_items`
//    returns zero rows, not an error
//  - a blank (whitespace-only) checklist item is rejected at the database
//    level (mirrors the tasks/comments not-blank precedent)
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment — but runs for real whenever `.env` is populated, which is the
// case in this repo. Mirrors tests/integration/rls-comments.test.ts (F058).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const haveCoreCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
if (process.env.CI && !haveCoreCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCoreCreds)("RLS on checklist_items (F151) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-274: anon/publishable key with no session reading checklist_items returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("checklist_items").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "checklist_items schema + RLS — member vs non-member of the owning task's workspace (F151)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
    let itemAId: string;
    let memberAUserId: string;
    let memberAEmail: string;
    let memberAPassword: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let memberAClient: SupabaseClient;
    let nonMemberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Workspace A + an active member of it.
      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F151 RLS workspace A", slug: `f151-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B, used only to hold the non-member's own membership so
      // they have a valid session in *some* workspace (AS-274 requires the
      // isolation to hold even then).
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F151 RLS workspace B", slug: `f151-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f151-member-a-${uniqueSuffix}@example.com`;
      memberAPassword = "Test-password-1!";
      const { data: memberAAuth, error: memberAAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberAEmail,
          password: memberAPassword,
          email_confirm: true,
        });
      if (memberAAuthErr || !memberAAuth.user) {
        throw new Error(`Failed to create member-A test user: ${memberAAuthErr?.message}`);
      }
      memberAUserId = memberAAuth.user.id;

      const { error: memberAInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: memberAUserId,
        role: "owner",
        status: "active",
      });
      if (memberAInsertErr) {
        throw new Error(`Failed to seed member-A membership: ${memberAInsertErr.message}`);
      }

      nonMemberEmail = `f151-nonmember-${uniqueSuffix}@example.com`;
      nonMemberPassword = "Test-password-1!";
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: nonMemberPassword,
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(`Failed to create non-member test user: ${nonMemberAuthErr?.message}`);
      }

      const { error: nonMemberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: nonMemberAuth.user.id,
        role: "owner",
        status: "active",
      });
      if (nonMemberInsertErr) {
        throw new Error(
          `Failed to seed non-member membership in workspace B: ${nonMemberInsertErr.message}`,
        );
      }

      // A project belonging to workspace A, seeded via the secret-key client.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F151 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      // A task belonging to project A, seeded via the secret-key client.
      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F151 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      // A checklist item on task A, seeded via the secret-key client.
      const { data: itemA, error: itemAErr } = await adminClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content: "F151 seeded checklist item", is_checked: false })
        .select("id")
        .single();
      if (itemAErr || !itemA) {
        throw new Error(`Failed to seed checklist item A: ${itemAErr?.message}`);
      }
      itemAId = itemA.id;

      memberAClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberASignInErr } = await memberAClient.auth.signInWithPassword({
        email: memberAEmail,
        password: memberAPassword,
      });
      if (memberASignInErr) {
        throw new Error(`Failed to sign in member-A test user: ${memberASignInErr.message}`);
      }

      nonMemberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: nonMemberSignInErr } = await nonMemberClient.auth.signInWithPassword({
        email: nonMemberEmail,
        password: nonMemberPassword,
      });
      if (nonMemberSignInErr) {
        throw new Error(`Failed to sign in non-member test user: ${nonMemberSignInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort cleanup so re-runs stay clean.
      if (itemAId) {
        await adminClient.from("checklist_items").delete().eq("id", itemAId);
      }
      if (taskAId) {
        await adminClient.from("tasks").delete().eq("id", taskAId);
      }
      if (projectAId) {
        await adminClient.from("projects").delete().eq("id", projectAId);
      }
      if (workspaceAId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceAId);
        await adminClient.from("workspaces").delete().eq("id", workspaceAId);
      }
      if (workspaceBId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceBId);
        await adminClient.from("workspaces").delete().eq("id", workspaceBId);
      }
      if (memberAUserId) {
        await adminClient.auth.admin.deleteUser(memberAUserId);
      }
      if (nonMemberClient) {
        const { data } = await nonMemberClient.auth.getUser();
        if (data.user) {
          await adminClient.auth.admin.deleteUser(data.user.id);
        }
      }
    });

    it("AS-269: a task can have a checklist item with text content and a checked state, and both persist as written", async () => {
      const { data, error } = await adminClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content: "Buy milk", is_checked: true })
        .select("id, task_id, content, is_checked")
        .single();
      expect(error).toBeNull();
      expect(data?.task_id).toBe(taskAId);
      expect(data?.content).toBe("Buy milk");
      expect(data?.is_checked).toBe(true);

      // Re-read to prove the state was actually persisted, not just echoed
      // back by the insert response.
      const { data: reread, error: rereadErr } = await adminClient
        .from("checklist_items")
        .select("content, is_checked")
        .eq("id", data!.id)
        .single();
      expect(rereadErr).toBeNull();
      expect(reread?.content).toBe("Buy milk");
      expect(reread?.is_checked).toBe(true);

      await adminClient.from("checklist_items").delete().eq("id", data!.id);
    });

    it("AS-269: a checklist item defaults to unchecked when is_checked is omitted", async () => {
      const { data, error } = await adminClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content: "Defaults to unchecked" })
        .select("is_checked")
        .single();
      expect(error).toBeNull();
      expect(data?.is_checked).toBe(false);

      await adminClient.from("checklist_items").delete().eq("content", "Defaults to unchecked");
    });

    it("an empty (whitespace-only) checklist item content is rejected at the database level", async () => {
      const { error } = await adminClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content: "   " });
      expect(error).not.toBeNull();
    });

    it("a member of workspace A can SELECT workspace A's checklist item", async () => {
      const { data, error } = await memberAClient
        .from("checklist_items")
        .select("id, content, task_id")
        .eq("id", itemAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(itemAId);
    });

    it("a member of workspace A can INSERT a new checklist item on task A", async () => {
      const { data, error } = await memberAClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content: "F151 member-created item" })
        .select("id, task_id")
        .single();
      expect(error).toBeNull();
      expect(data?.task_id).toBe(taskAId);
      if (data?.id) {
        await adminClient.from("checklist_items").delete().eq("id", data.id);
      }
    });

    it("AS-274: a non-member cannot INSERT a checklist item claiming a task_id in a workspace they don't belong to", async () => {
      const { error } = await nonMemberClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content: "should be rejected" });
      expect(error).not.toBeNull();
    });

    it("AS-274: a user not a member of the checklist item's task's workspace gets zero rows querying the item directly", async () => {
      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .select("*")
        .eq("id", itemAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-274: a non-member gets zero rows via a join-style query on task_id (checklist_items -> tasks)", async () => {
      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .select("id, content, tasks(id, title)")
        .eq("id", itemAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-274: full list query scoped to task A returns zero rows for a non-member, even with a valid session in workspace B", async () => {
      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .select("*")
        .eq("task_id", taskAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
