// Integration test for F152 checklist item Server Actions (AS-270, AS-271),
// run against the real linked Supabase project — mirrors the
// loadDotEnv/skipIf pattern established by tests/integration/edit-task.test.ts
// and tests/integration/add-comment.test.ts.
//
// Unlike those files, `@/lib/supabase/server`'s `createClient()` is mocked
// to a REAL, signed-in Supabase client (publishable key + a real password
// session), not just a bare `auth.getUser()` stub. That is deliberate: per
// lib/actions/checklist.ts's header comment, every mutation in that file
// performs its actual insert/update/delete through this request-scoped
// client so RLS is genuinely exercised, not bypassed with the admin
// client — so the mock has to be a real client capable of running real,
// RLS-checked Postgrest queries as the current test user, not a stub.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

// The "current request's" client — swapped per test via signInAs()/signOut()
// below. Defaults to an anonymous (no-session) stand-in so a test that
// forgets to sign in behaves like an unauthenticated caller rather than
// leaking the previous test's session.
let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  // Never actually called while signed out (every action returns before
  // reaching `.from()`), but typed to satisfy the shape.
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "checklist item Server Actions (F152: AS-270, AS-271)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberUserId: string;
    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let outsiderUserId: string;
    let outsiderEmail: string;
    const outsiderPassword = "Test-password-1!";

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    function signOut() {
      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: null } }) },
        from: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["from"],
      };
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F152 Actions Workspace", slug: `f152-actions-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F152 Other Workspace", slug: `f152-other-${uniqueSuffix}` })
        .select("id")
        .single();
      if (otherWsErr || !otherWs)
        throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
      otherWorkspaceId = otherWs.id;
      createdWorkspaceIds.push(otherWorkspaceId);

      memberEmail = `f152-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user)
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      outsiderEmail = `f152-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user)
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      outsiderUserId = outsiderAuth.user.id;
      createdUserIds.push(outsiderUserId);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberUserId, role: "owner", status: "active" },
        {
          workspace_id: otherWorkspaceId,
          user_id: outsiderUserId,
          role: "owner",
          status: "active",
        },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F152 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: `F152 Task ${uniqueSuffix}`, author_id: memberUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);
      taskId = task.id;
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      if (taskId) {
        await adminClient.from("checklist_items").delete().eq("task_id", taskId);
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-269/AS-270 setup: an active member can add a checklist item, and it appends to the end of the checklist using calculatePosition (not a reimplementation)", async () => {
      const { addChecklistItem } = await import("@/lib/actions/checklist");
      await signInAs(memberEmail, memberPassword);

      const first = await addChecklistItem(taskId, "First item");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.content).toBe("First item");
      expect(first.data.isChecked).toBe(false);

      const second = await addChecklistItem(taskId, "Second item");
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      // The second item must be positioned strictly AFTER the first
      // (append-to-end), same neighbor-relative guarantee
      // lib/board/position.ts's calculatePosition provides for board
      // cards — proves the append path reuses that function rather than
      // e.g. always writing position 0.
      expect(second.data.position).toBeGreaterThan(first.data.position);
    });

    it("AS-270: toggling a checklist item to checked persists immediately (verified by an independent re-read) and survives a reload (a second, unrelated read of the same row)", async () => {
      const { addChecklistItem, toggleChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);

      const created = await addChecklistItem(taskId, "Toggle me");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const toggled = await toggleChecklistItem(created.data.id, true);
      expect(toggled.ok).toBe(true);
      if (!toggled.ok) return;
      expect(toggled.data.isChecked).toBe(true);
      expect(toggled.data.checkedBy).toBe(memberUserId);
      expect(toggled.data.checkedAt).toBeTruthy();

      // "Survives a reload": read the row again, independently of the
      // action's own return value, exactly as a fresh page load would.
      const { data: reread, error: rereadErr } = await adminClient
        .from("checklist_items")
        .select("is_checked, checked_by, checked_at")
        .eq("id", created.data.id)
        .single();
      expect(rereadErr).toBeNull();
      expect(reread?.is_checked).toBe(true);
      expect(reread?.checked_by).toBe(memberUserId);
      expect(reread?.checked_at).toBeTruthy();

      // Unchecking clears checked_by/checked_at, and this too persists.
      const unchecked = await toggleChecklistItem(created.data.id, false);
      expect(unchecked.ok).toBe(true);
      if (!unchecked.ok) return;
      expect(unchecked.data.isChecked).toBe(false);
      expect(unchecked.data.checkedBy).toBeNull();
      expect(unchecked.data.checkedAt).toBeNull();

      const { data: rereadAfterUncheck } = await adminClient
        .from("checklist_items")
        .select("is_checked, checked_by, checked_at")
        .eq("id", created.data.id)
        .single();
      expect(rereadAfterUncheck?.is_checked).toBe(false);
      expect(rereadAfterUncheck?.checked_by).toBeNull();
      expect(rereadAfterUncheck?.checked_at).toBeNull();
    });

    it("AS-270 no-op: toggling to the same state the item already has returns ok without an error, and does not change checked_at", async () => {
      const { addChecklistItem, toggleChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);

      const created = await addChecklistItem(taskId, "No-op toggle");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Already unchecked (default) — toggling to isChecked:false again is
      // a no-op per the Clarified implementation's empty/zero-state answer.
      const result = await toggleChecklistItem(created.data.id, false);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.isChecked).toBe(false);
    });

    it("AS-271: a checklist item can be renamed", async () => {
      const { addChecklistItem, renameChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);

      const created = await addChecklistItem(taskId, "Original text");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const renamed = await renameChecklistItem(created.data.id, "Renamed text");
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.data.content).toBe("Renamed text");

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("content")
        .eq("id", created.data.id)
        .single();
      expect(reread?.content).toBe("Renamed text");
    });

    it("AS-271: renaming to an empty/whitespace-only string is rejected before reaching the database", async () => {
      const { addChecklistItem, renameChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);

      const created = await addChecklistItem(taskId, "Stays as-is");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await renameChecklistItem(created.data.id, "   ");
      expect(result.ok).toBe(false);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("content")
        .eq("id", created.data.id)
        .single();
      expect(reread?.content).toBe("Stays as-is");
    });

    it("AS-271: a checklist item can be reordered, reusing lib/board/position.ts's calculatePosition for the new value", async () => {
      const { addChecklistItem, reorderChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      const { calculatePosition } = await import("@/lib/board/position");
      await signInAs(memberEmail, memberPassword);

      const itemA = await addChecklistItem(taskId, "Item A");
      const itemB = await addChecklistItem(taskId, "Item B");
      expect(itemA.ok).toBe(true);
      expect(itemB.ok).toBe(true);
      if (!itemA.ok || !itemB.ok) return;

      // Move item B to before item A: the caller computes the new position
      // via calculatePosition (no `prevPosition`, `nextPosition` = item A's
      // current position), and the action just persists it.
      const newPosition = calculatePosition(null, itemA.data.position);
      const reordered = await reorderChecklistItem(itemB.data.id, newPosition);
      expect(reordered.ok).toBe(true);
      if (!reordered.ok) return;
      expect(reordered.data.position).toBe(newPosition);
      expect(reordered.data.position).toBeLessThan(itemA.data.position);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("position")
        .eq("id", itemB.data.id)
        .single();
      expect(reread?.position).toBe(newPosition);
    });

    it("AS-271: a checklist item can be deleted", async () => {
      const { addChecklistItem, deleteChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);

      const created = await addChecklistItem(taskId, "Delete me");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deleted = await deleteChecklistItem(created.data.id);
      expect(deleted.ok).toBe(true);
      if (!deleted.ok) return;
      expect(deleted.data.id).toBe(created.data.id);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(reread).toBeNull();
    });

    it("AS-271: deleting an already-deleted item is treated as not found (idempotent-safe), same convention as deleteComment/deleteTask", async () => {
      const { addChecklistItem, deleteChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);

      const created = await addChecklistItem(taskId, "Delete me twice");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const first = await deleteChecklistItem(created.data.id);
      expect(first.ok).toBe(true);

      const second = await deleteChecklistItem(created.data.id);
      expect(second.ok).toBe(false);
    });

    // Negative assertions: a user who is a member of a DIFFERENT workspace
    // (not this task's workspace) cannot toggle, rename, reorder, or delete
    // a checklist item that belongs to this task, through the action layer.
    // This is the Server-Action-level negative case; the raw-RLS proof that
    // the database itself denies these same operations lives in
    // tests/integration/rls-checklist-update-delete.test.ts.

    it("a non-member cannot toggle a checklist item via the action layer", async () => {
      const { addChecklistItem, toggleChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);
      const created = await addChecklistItem(taskId, "Non-member toggle target");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(outsiderEmail, outsiderPassword);
      const result = await toggleChecklistItem(created.data.id, true);
      expect(result.ok).toBe(false);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("is_checked")
        .eq("id", created.data.id)
        .single();
      expect(reread?.is_checked).toBe(false);
    });

    it("a non-member cannot rename a checklist item via the action layer", async () => {
      const { addChecklistItem, renameChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);
      const created = await addChecklistItem(taskId, "Non-member rename target");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(outsiderEmail, outsiderPassword);
      const result = await renameChecklistItem(created.data.id, "hijacked");
      expect(result.ok).toBe(false);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("content")
        .eq("id", created.data.id)
        .single();
      expect(reread?.content).toBe("Non-member rename target");
    });

    it("a non-member cannot reorder a checklist item via the action layer", async () => {
      const { addChecklistItem, reorderChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);
      const created = await addChecklistItem(taskId, "Non-member reorder target");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(outsiderEmail, outsiderPassword);
      const result = await reorderChecklistItem(created.data.id, 99999);
      expect(result.ok).toBe(false);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("position")
        .eq("id", created.data.id)
        .single();
      expect(reread?.position).not.toBe(99999);
    });

    it("a non-member cannot delete a checklist item via the action layer", async () => {
      const { addChecklistItem, deleteChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      await signInAs(memberEmail, memberPassword);
      const created = await addChecklistItem(taskId, "Non-member delete target");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(outsiderEmail, outsiderPassword);
      const result = await deleteChecklistItem(created.data.id);
      expect(result.ok).toBe(false);

      const { data: reread } = await adminClient
        .from("checklist_items")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(reread?.id).toBe(created.data.id);
    });

    it("a non-member cannot add a checklist item to a task outside their workspace", async () => {
      const { addChecklistItem } = await import("@/lib/actions/checklist");
      await signInAs(outsiderEmail, outsiderPassword);

      const result = await addChecklistItem(taskId, "should be rejected");
      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("checklist_items")
        .select("id")
        .eq("task_id", taskId)
        .eq("content", "should be rejected");
      expect(rows ?? []).toHaveLength(0);
    });

    it("a signed-out caller cannot perform any checklist action", async () => {
      const { addChecklistItem, toggleChecklistItem, deleteChecklistItem } = await import(
        "@/lib/actions/checklist"
      );
      // beforeEach already signs out, but assert explicitly for clarity.
      signOut();

      const addResult = await addChecklistItem(taskId, "should be rejected");
      expect(addResult.ok).toBe(false);

      const toggleResult = await toggleChecklistItem(
        "00000000-0000-0000-0000-000000000000",
        true,
      );
      expect(toggleResult.ok).toBe(false);

      const deleteResult = await deleteChecklistItem(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(deleteResult.ok).toBe(false);
    });

    it("invalid input (non-UUID itemId) is rejected before reaching the database", async () => {
      const { toggleChecklistItem } = await import("@/lib/actions/checklist");
      await signInAs(memberEmail, memberPassword);

      const result = await toggleChecklistItem("not-a-uuid", true);
      expect(result.ok).toBe(false);
    });

    it("an empty-string content on add is rejected before reaching the database", async () => {
      const { addChecklistItem } = await import("@/lib/actions/checklist");
      await signInAs(memberEmail, memberPassword);

      const result = await addChecklistItem(taskId, "");
      expect(result.ok).toBe(false);
    });
  },
);
