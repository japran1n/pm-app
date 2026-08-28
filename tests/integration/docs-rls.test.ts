// W2 (mission 20260828-hardening): integration test for role restrictions on
// `docs` / `doc_folders` RLS.
//
// Regression cover for two production security holes, both empirically
// confirmed against the live database before the fix
// (supabase/migrations/20260905030000_docs_rls_role_restrictions.sql):
//
//  1. The `client` role — the EXTERNAL customer role backing the client
//     portal — is an active `workspace_members` row, so the role-agnostic
//     `is_active_workspace_member()` predicate granted it full
//     SELECT/INSERT/UPDATE/DELETE on every internal doc in the workspace.
//     A client could read, edit, or delete internal engineering docs,
//     roadmaps and meeting notes by calling PostgREST directly.
//
//  2. The `viewer` role — read-only everywhere else in the app (see
//     canWrite() in lib/auth/permissions.ts, which excludes `viewer` and
//     `client`) — could INSERT/UPDATE/DELETE docs. The UI hid the buttons;
//     the API did not.
//
// Every assertion here runs through a real password-authenticated
// publishable-key session, never the service-role admin client — the admin
// client bypasses RLS, which would make these tests vacuous. The admin
// client is used only for fixture setup and teardown.
//
// Note on `docs.created_by`: it is NOT NULL. An insert that omits it fails
// on the column constraint rather than on RLS, which reads as a false
// "denied" for every role. Each insert probe below supplies it explicitly
// so that a denial is genuinely attributable to policy.
//
// Skips (rather than fails) when Supabase credentials aren't present,
// mirroring tests/integration/rls-activity.test.ts.

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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "W2/docs-rls: missing Supabase credentials required to run this suite in CI. " +
      "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and " +
      "SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

type WorkspaceRole = "member" | "viewer" | "client";

describe.skipIf(!haveAdminCreds)(
  "RLS role restrictions on docs / doc_folders (W2)",
  () => {
    let admin: SupabaseClient;
    let workspaceId: string;
    let ownerId: string;
    let seedDocId: string;
    let seedFolderId: string;

    const stamp = Date.now();
    const password = `Tp${Math.random().toString(36).slice(2)}!A9`;
    const createdUserIds: string[] = [];
    const sessions = new Map<WorkspaceRole, { client: SupabaseClient; userId: string }>();

    async function makeUser(role: WorkspaceRole) {
      const email = `w2-docs-${role}-${stamp}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser(${role}): ${error?.message}`);
      createdUserIds.push(data.user.id);

      const { error: memberError } = await admin.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: data.user.id,
        role,
        status: "active",
      });
      if (memberError) throw new Error(`workspace_members(${role}): ${memberError.message}`);

      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(`signIn(${role}): ${signInError.message}`);

      sessions.set(role, { client, userId: data.user.id });
    }

    function as(role: WorkspaceRole) {
      const session = sessions.get(role);
      if (!session) throw new Error(`no session for role ${role}`);
      return session;
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Owner of the throwaway workspace this suite operates in. A
      // dedicated workspace keeps the test independent of seeded data.
      const { data: owner, error: ownerError } = await admin.auth.admin.createUser({
        email: `w2-docs-owner-${stamp}@example.com`,
        password,
        email_confirm: true,
      });
      if (ownerError || !owner.user) throw new Error(`owner: ${ownerError?.message}`);
      ownerId = owner.user.id;
      createdUserIds.push(ownerId);

      const { data: workspace, error: workspaceError } = await admin
        .from("workspaces")
        .insert({ name: `W2 Docs RLS ${stamp}`, slug: `w2-docs-rls-${stamp}` })
        .select("id")
        .single();
      if (workspaceError || !workspace) throw new Error(`workspace: ${workspaceError?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        role: "owner",
        status: "active",
      });

      const { data: doc, error: docError } = await admin
        .from("docs")
        .insert({
          workspace_id: workspaceId,
          title: `seed doc ${stamp}`,
          content: "internal",
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (docError || !doc) throw new Error(`seed doc: ${docError?.message}`);
      seedDocId = doc.id;

      const { data: folder, error: folderError } = await admin
        .from("doc_folders")
        .insert({ workspace_id: workspaceId, name: `seed folder ${stamp}`, created_by: ownerId })
        .select("id")
        .single();
      if (folderError || !folder) throw new Error(`seed folder: ${folderError?.message}`);
      seedFolderId = folder.id;

      await makeUser("member");
      await makeUser("viewer");
      await makeUser("client");
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("docs").delete().eq("workspace_id", workspaceId);
      await admin.from("doc_folders").delete().eq("workspace_id", workspaceId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }, 60_000);

    describe("client role (external customer) is fully excluded from docs", () => {
      it("cannot SELECT docs", async () => {
        const { data, error } = await as("client").client.from("docs").select("id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("cannot INSERT a doc", async () => {
        const { userId, client } = as("client");
        const { data, error } = await client
          .from("docs")
          .insert({
            workspace_id: workspaceId,
            title: `client insert ${stamp}`,
            content: "x",
            created_by: userId,
          })
          .select("id");
        expect(data ?? []).toEqual([]);
        expect(error).not.toBeNull();
      });

      it("cannot UPDATE an existing doc", async () => {
        const { data } = await as("client")
          .client.from("docs")
          .update({ title: `client tamper ${stamp}` })
          .eq("id", seedDocId)
          .select("id");
        expect(data ?? []).toEqual([]);

        const { data: check } = await admin
          .from("docs")
          .select("title")
          .eq("id", seedDocId)
          .single();
        expect(check?.title).toBe(`seed doc ${stamp}`);
      });

      it("cannot DELETE a doc", async () => {
        const { data } = await as("client")
          .client.from("docs")
          .delete()
          .eq("id", seedDocId)
          .select("id");
        expect(data ?? []).toEqual([]);

        const { data: check } = await admin.from("docs").select("id").eq("id", seedDocId);
        expect(check).toHaveLength(1);
      });

      it("cannot SELECT doc_folders", async () => {
        const { data, error } = await as("client").client.from("doc_folders").select("id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("cannot DELETE a doc_folder", async () => {
        const { data } = await as("client")
          .client.from("doc_folders")
          .delete()
          .eq("id", seedFolderId)
          .select("id");
        expect(data ?? []).toEqual([]);

        const { data: check } = await admin
          .from("doc_folders")
          .select("id")
          .eq("id", seedFolderId);
        expect(check).toHaveLength(1);
      });
    });

    describe("viewer role is read-only", () => {
      it("CAN SELECT docs", async () => {
        const { data, error } = await as("viewer").client.from("docs").select("id");
        expect(error).toBeNull();
        expect(data?.map((row) => row.id)).toContain(seedDocId);
      });

      it("cannot INSERT a doc", async () => {
        const { userId, client } = as("viewer");
        const { data, error } = await client
          .from("docs")
          .insert({
            workspace_id: workspaceId,
            title: `viewer insert ${stamp}`,
            content: "x",
            created_by: userId,
          })
          .select("id");
        expect(data ?? []).toEqual([]);
        expect(error).not.toBeNull();
      });

      it("cannot UPDATE a doc", async () => {
        const { data } = await as("viewer")
          .client.from("docs")
          .update({ title: `viewer tamper ${stamp}` })
          .eq("id", seedDocId)
          .select("id");
        expect(data ?? []).toEqual([]);

        const { data: check } = await admin
          .from("docs")
          .select("title")
          .eq("id", seedDocId)
          .single();
        expect(check?.title).toBe(`seed doc ${stamp}`);
      });

      it("cannot DELETE a doc", async () => {
        const { data } = await as("viewer")
          .client.from("docs")
          .delete()
          .eq("id", seedDocId)
          .select("id");
        expect(data ?? []).toEqual([]);

        const { data: check } = await admin.from("docs").select("id").eq("id", seedDocId);
        expect(check).toHaveLength(1);
      });

      it("cannot DELETE a doc_folder", async () => {
        const { data } = await as("viewer")
          .client.from("doc_folders")
          .delete()
          .eq("id", seedFolderId)
          .select("id");
        expect(data ?? []).toEqual([]);
      });
    });

    describe("member role retains full access (the fix must not over-restrict)", () => {
      it("can SELECT, INSERT, UPDATE and DELETE docs", async () => {
        const { userId, client } = as("member");

        const { data: selected, error: selectError } = await client.from("docs").select("id");
        expect(selectError).toBeNull();
        expect(selected?.map((row) => row.id)).toContain(seedDocId);

        const { data: inserted, error: insertError } = await client
          .from("docs")
          .insert({
            workspace_id: workspaceId,
            title: `member insert ${stamp}`,
            content: "x",
            created_by: userId,
          })
          .select("id")
          .single();
        expect(insertError).toBeNull();
        expect(inserted?.id).toBeTruthy();

        const { data: updated } = await client
          .from("docs")
          .update({ title: `member updated ${stamp}` })
          .eq("id", inserted!.id)
          .select("id");
        expect(updated).toHaveLength(1);

        const { data: deleted } = await client
          .from("docs")
          .delete()
          .eq("id", inserted!.id)
          .select("id");
        expect(deleted).toHaveLength(1);
      });

      it("can SELECT and INSERT doc_folders", async () => {
        const { userId, client } = as("member");

        const { data: selected, error: selectError } = await client
          .from("doc_folders")
          .select("id");
        expect(selectError).toBeNull();
        expect(selected?.map((row) => row.id)).toContain(seedFolderId);

        const { data: inserted, error: insertError } = await client
          .from("doc_folders")
          .insert({
            workspace_id: workspaceId,
            name: `member folder ${stamp}`,
            created_by: userId,
          })
          .select("id")
          .single();
        expect(insertError).toBeNull();
        expect(inserted?.id).toBeTruthy();

        await admin.from("doc_folders").delete().eq("id", inserted!.id);
      });
    });
  },
);
