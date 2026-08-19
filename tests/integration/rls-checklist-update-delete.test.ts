// Integration test for F152's UPDATE + DELETE RLS policies on
// checklist_items (AS-270, AS-271), run against the real linked Supabase
// project — mirrors tests/integration/rls-checklist.test.ts's (F151)
// loadDotEnv/skipIf/real-session pattern exactly, extended to the two
// policies this feature adds
// (supabase/migrations/20260819080358_checklist_items_update_delete_policies.sql).
//
// This file talks to `checklist_items` DIRECTLY with real signed-in
// publishable-key clients — it does NOT go through
// lib/actions/checklist.ts. That is deliberate: this is the proof that the
// database-level RLS policy itself is scoped correctly (through
// `public.is_task_workspace_member`, not `using (true)`), independent of
// whatever the Server Action layer's own membership check does. The
// Server-Action-level behavior (including the "not found" vs "permission
// denied" messaging, and the no-write no-op cases) is covered separately
// by tests/integration/checklist-actions.test.ts.

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

const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

describe.skipIf(!haveAdminCreds)(
  "checklist_items UPDATE/DELETE RLS — member vs non-member of the owning task's workspace (F152)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
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

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F152 RLS workspace A", slug: `f152-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B holds the non-member's own membership so they have a
      // valid session in *some* workspace — AS-274/this feature's
      // isolation must hold even then (F151's precedent).
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F152 RLS workspace B", slug: `f152-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f152-member-a-${uniqueSuffix}@example.com`;
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

      nonMemberEmail = `f152-nonmember-${uniqueSuffix}@example.com`;
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

      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F152 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F152 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

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
      if (taskAId) {
        await adminClient.from("checklist_items").delete().eq("task_id", taskAId);
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

    async function seedItem(content: string): Promise<string> {
      const { data, error } = await adminClient
        .from("checklist_items")
        .insert({ task_id: taskAId, content })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed checklist item: ${error?.message}`);
      }
      return data.id;
    }

    it("AS-270: a member of workspace A can UPDATE (toggle) workspace A's checklist item", async () => {
      const itemId = await seedItem("F152 member toggle test");

      const { data, error } = await memberAClient
        .from("checklist_items")
        .update({ is_checked: true })
        .eq("id", itemId)
        .select("id, is_checked");

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.is_checked).toBe(true);

      // Re-read with the admin client to prove it actually persisted, not
      // just echoed back.
      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("is_checked")
        .eq("id", itemId)
        .single();
      expect(reread?.is_checked).toBe(true);
    });

    it("AS-271: a member of workspace A can UPDATE (rename) workspace A's checklist item", async () => {
      const itemId = await seedItem("F152 member rename test — before");

      const { data, error } = await memberAClient
        .from("checklist_items")
        .update({ content: "F152 member rename test — after" })
        .eq("id", itemId)
        .select("id, content");

      expect(error).toBeNull();
      expect(data?.[0]?.content).toBe("F152 member rename test — after");
    });

    it("AS-271: a member of workspace A can UPDATE (reorder) workspace A's checklist item", async () => {
      const itemId = await seedItem("F152 member reorder test");

      const { data, error } = await memberAClient
        .from("checklist_items")
        .update({ position: 4242 })
        .eq("id", itemId)
        .select("id, position");

      expect(error).toBeNull();
      expect(data?.[0]?.position).toBe(4242);
    });

    it("AS-271: a member of workspace A can DELETE workspace A's checklist item", async () => {
      const itemId = await seedItem("F152 member delete test");

      const { data, error } = await memberAClient
        .from("checklist_items")
        .delete()
        .eq("id", itemId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("id")
        .eq("id", itemId)
        .maybeSingle();
      expect(reread).toBeNull();
    });

    it("AS-270/AS-274: a non-member CANNOT UPDATE (toggle) a checklist item in a workspace they don't belong to", async () => {
      const itemId = await seedItem("F152 non-member toggle test");

      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .update({ is_checked: true })
        .eq("id", itemId)
        .select("id, is_checked");

      // RLS denies by filtering, not by erroring: the UPDATE affects zero
      // rows rather than raising a Postgres error. This is the proof the
      // policy is scoped through is_task_workspace_member (a member-scoped
      // predicate), not `using (true)` — a `using (true)` policy would let
      // this UPDATE succeed and return the row.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("is_checked")
        .eq("id", itemId)
        .single();
      expect(reread?.is_checked).toBe(false);
    });

    it("AS-271/AS-274: a non-member CANNOT UPDATE (rename) a checklist item in a workspace they don't belong to", async () => {
      const itemId = await seedItem("F152 non-member rename test — before");

      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .update({ content: "should not be applied" })
        .eq("id", itemId)
        .select("id, content");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("content")
        .eq("id", itemId)
        .single();
      expect(reread?.content).toBe("F152 non-member rename test — before");
    });

    it("AS-271/AS-274: a non-member CANNOT UPDATE (reorder) a checklist item in a workspace they don't belong to", async () => {
      const itemId = await seedItem("F152 non-member reorder test");
      const { data: original } = await adminClient
        .from("checklist_items")
        .select("position")
        .eq("id", itemId)
        .single();

      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .update({ position: 9999 })
        .eq("id", itemId)
        .select("id, position");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("position")
        .eq("id", itemId)
        .single();
      expect(reread?.position).toBe(original?.position);
    });

    it("AS-271/AS-274: a non-member CANNOT DELETE a checklist item in a workspace they don't belong to, even with a valid session in workspace B", async () => {
      const itemId = await seedItem("F152 non-member delete test");

      const { data, error } = await nonMemberClient
        .from("checklist_items")
        .delete()
        .eq("id", itemId)
        .select("id");

      // Same "filtered, not errored" shape: zero rows affected.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The item must still exist, proving the DELETE was truly a no-op
      // and not a delayed/partial delete.
      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("id")
        .eq("id", itemId)
        .maybeSingle();
      expect(reread?.id).toBe(itemId);
    });
  },
);
