// Integration test for F131 (project_members Server Action layer: AS-224
// — "a project has an explicit member list; adding a member grants
// access"), run against the real linked Supabase project.
//
// Scenario setup mirrors tests/integration/rls-project-visibility.test.ts
// (F132): one workspace, one owner, one plain workspace member who starts
// as an OUTSIDER to a private project (no project_members row, cannot see
// it), and one private project with a task. This file adds the
// AS-224-specific proof that goes beyond F132's own RLS assertions:
// actually calling addProjectMember/removeProjectMember (the Server Action
// this feature adds) and proving the access grant/revoke is real, not just
// that a raw INSERT into project_members would work.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { addProjectMember, removeProjectMember } from "@/lib/actions/project-members";

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
    "F131: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// This test calls the real Server Actions, which read the caller's session
// via lib/supabase/server.ts's createClient() (cookie-based, request-scoped
// — not available outside a Next.js request). Mock it to return a plain
// supabase-js client authenticated as whichever user we're impersonating
// for a given call, same technique this mission's other action-layer
// integration tests use for actions that call createClient() directly.
let currentSessionClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "project_members Server Actions — add/remove grants/revokes access (F131, AS-224)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let ownerUserId: string;
    let outsiderUserId: string;
    let ownerEmail: string;
    let outsiderEmail: string;
    const password = "Test-password-1!";
    let ownerSessionClient: SupabaseClient;
    let outsiderSessionClient: SupabaseClient;
    let outsiderClient: SupabaseClient;

    let privateProjectId: string;
    let privateTaskId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F131 project-members workspace", slug: `f131-pm-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      async function createUser(label: string) {
        const email = `f131-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`Failed to create ${label}: ${error?.message}`);
        return { email, userId: data.user.id };
      }

      const owner = await createUser("owner");
      ownerEmail = owner.email;
      ownerUserId = owner.userId;

      const outsider = await createUser("outsider");
      outsiderEmail = outsider.email;
      outsiderUserId = outsider.userId;

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: outsiderUserId, role: "member", status: "active" },
      ]);
      if (membersErr) throw new Error(`Failed to seed workspace members: ${membersErr.message}`);

      const { data: privProj, error: privProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F131 private project",
          visibility: "private",
        })
        .select("id")
        .single();
      if (privProjErr || !privProj)
        throw new Error(`Failed to seed private project: ${privProjErr?.message}`);
      privateProjectId = privProj.id;

      const { data: privTask, error: privTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F131 private task",
          author_id: ownerUserId,
        })
        .select("id")
        .single();
      if (privTaskErr || !privTask)
        throw new Error(`Failed to seed private task: ${privTaskErr?.message}`);
      privateTaskId = privTask.id;

      async function signIn(email: string) {
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
        return client;
      }

      outsiderClient = await signIn(outsiderEmail);
      // Separate session clients so the action-under-test's createClient()
      // mock returns an independently-signed-in client per call, same
      // credentials, no shared mutable auth state with the read clients
      // above used for direct RLS assertions.
      ownerSessionClient = await signIn(ownerEmail);
      outsiderSessionClient = await signIn(outsiderEmail);
    });

    afterAll(async () => {
      if (privateTaskId) {
        await adminClient.from("tasks").delete().eq("id", privateTaskId);
      }
      if (privateProjectId) {
        await adminClient.from("project_members").delete().eq("project_id", privateProjectId);
        await adminClient.from("projects").delete().eq("id", privateProjectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of [ownerUserId, outsiderUserId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-224 (precondition): before being added, the outsider CANNOT see the private project (zero rows, not an error)", async () => {
      const { data, error } = await outsiderClient
        .from("projects")
        .select("id")
        .eq("id", privateProjectId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-224: a workspace owner CAN add a member to a project's explicit member list via the Server Action", async () => {
      currentSessionClient = ownerSessionClient;
      const result = await addProjectMember(privateProjectId, outsiderUserId, "member");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.projectId).toBe(privateProjectId);
        expect(result.data.userId).toBe(outsiderUserId);
        expect(result.data.projectRole).toBe("member");
      }

      const { data: row } = await adminClient
        .from("project_members")
        .select("id, project_id, user_id, project_role")
        .eq("project_id", privateProjectId)
        .eq("user_id", outsiderUserId)
        .maybeSingle();
      expect(row).not.toBeNull();
    });

    it("AS-224: adding a member GRANTS them access — the same outsider can now see the private project and its task", async () => {
      const { data: proj, error: projErr } = await outsiderClient
        .from("projects")
        .select("id")
        .eq("id", privateProjectId);
      expect(projErr).toBeNull();
      expect(proj).toHaveLength(1);

      const { data: task, error: taskErr } = await outsiderClient
        .from("tasks")
        .select("id")
        .eq("id", privateTaskId);
      expect(taskErr).toBeNull();
      expect(task).toHaveLength(1);
    });

    it("AS-224 (negative): adding the same member twice is rejected with a field-level message, not a generic 500", async () => {
      currentSessionClient = ownerSessionClient;
      const result = await addProjectMember(privateProjectId, outsiderUserId, "member");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("That user is already a member of this project.");
      }
    });

    it("AS-224 (negative): a non-owner/admin, non-lead member CANNOT add a project member — the action rejects it server-side", async () => {
      // outsiderUserId is now an explicit project member (added above) but
      // has role 'member', not 'lead' — still not authorized to add others.
      currentSessionClient = outsiderSessionClient;
      const result = await addProjectMember(privateProjectId, ownerUserId, "member");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "You don't have permission to add members to this project.",
        );
      }
    });

    it("AS-224: removing a member REVOKES the access it granted — the outsider can no longer see the private project", async () => {
      currentSessionClient = ownerSessionClient;
      const result = await removeProjectMember(privateProjectId, outsiderUserId);
      expect(result.ok).toBe(true);

      const { data, error } = await outsiderClient
        .from("projects")
        .select("id")
        .eq("id", privateProjectId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
