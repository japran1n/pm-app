// Integration test for F133 (project members management UI's data/action
// layer: AS-225 — "removing a project member revokes access on their next
// request", proved end-to-end through this feature's own
// updateProjectVisibility action and the AS-236 display query — and
// AS-236 — "the project members list shows each person's project role and
// who added them"), run against the real linked Supabase project.
//
// Scenario setup mirrors tests/integration/project-members-actions.test.ts
// (F131) and tests/integration/rls-project-visibility.test.ts (F132): one
// workspace, one owner, one plain workspace member, and one project
// created workspace-wide-visible so the toggle-to-private path (this
// feature's new action) is the thing under test, not F132's own private-
// project RLS (already covered by that feature's own suite).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  addProjectMember,
  removeProjectMember,
  updateProjectVisibility,
} from "@/lib/actions/project-members";
import { getProjectMembers } from "@/lib/queries/project-members";

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
    "F133: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Same session-mocking technique as project-members-actions.test.ts: the
// Server Actions and `getProjectMembers` read the caller's session via
// lib/supabase/server.ts's createClient(), which is cookie-based and only
// available inside a real Next.js request — mocked here to return a
// plain supabase-js client authenticated as whichever user is currently
// "acting".
let currentSessionClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "project members settings UI action/query layer (F133, AS-225, AS-236)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let ownerUserId: string;
    let memberUserId: string;
    let ownerEmail: string;
    let memberEmail: string;
    const password = "Test-password-1!";
    let ownerSessionClient: SupabaseClient;
    let memberSessionClient: SupabaseClient;
    let memberClient: SupabaseClient;

    let projectId: string;
    let taskId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F133 project-members-ui workspace", slug: `f133-pm-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      async function createUser(label: string) {
        const email = `f133-${label}-${uniqueSuffix}@example.com`;
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

      const member = await createUser("member");
      memberEmail = member.email;
      memberUserId = member.userId;

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      ]);
      if (membersErr) throw new Error(`Failed to seed workspace members: ${membersErr.message}`);

      // Workspace-wide visibility (the default) — everyone in the
      // workspace can see it before any project_members row exists,
      // which is exactly the state the visibility-toggle warning
      // (getVisibilityLossPreview) and AS-225's revoke path both start
      // from.
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F133 project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to seed project: ${projErr?.message}`);
      projectId = proj.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F133 task",
          author_id: ownerUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);
      taskId = task.id;

      async function signIn(email: string) {
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
        return client;
      }

      memberClient = await signIn(memberEmail);
      ownerSessionClient = await signIn(ownerEmail);
      memberSessionClient = await signIn(memberEmail);
    });

    afterAll(async () => {
      if (taskId) await adminClient.from("tasks").delete().eq("id", taskId);
      if (projectId) {
        await adminClient.from("project_members").delete().eq("project_id", projectId);
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of [ownerUserId, memberUserId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-236: the members list shows each person's project role and who added them", async () => {
      currentSessionClient = ownerSessionClient;
      const addResult = await addProjectMember(projectId, memberUserId, "lead");
      expect(addResult.ok).toBe(true);

      const members = await getProjectMembers(projectId);
      expect(members).toHaveLength(1);
      expect(members[0]!.userId).toBe(memberUserId);
      expect(members[0]!.projectRole).toBe("lead");
      // addedByName resolves to the owner's display name/email fallback,
      // never null/undefined, once added_by is populated.
      expect(members[0]!.addedByName).toBeTruthy();
      expect(members[0]!.addedByName).not.toBe("unknown");
    });

    it("AS-225: before removal, an explicit project member (now the lead) can see the project — precondition", async () => {
      const { data, error } = await memberClient
        .from("projects")
        .select("id")
        .eq("id", projectId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("AS-225: switching the project to private, then removing the member, revokes access on their next request", async () => {
      // Flip to private first (this feature's own action) — with the
      // member already an explicit project_members row, they keep access
      // through the switch itself (is_project_visible_to's explicit-row
      // branch), proving the toggle alone doesn't wrongly revoke access
      // from someone who has an explicit grant.
      currentSessionClient = ownerSessionClient;
      const visResult = await updateProjectVisibility(projectId, "private");
      expect(visResult.ok).toBe(true);
      if (visResult.ok) {
        expect(visResult.data.visibility).toBe("private");
      }

      const { data: stillVisible, error: stillVisibleErr } = await memberClient
        .from("projects")
        .select("id")
        .eq("id", projectId);
      expect(stillVisibleErr).toBeNull();
      expect(stillVisible).toHaveLength(1);

      // Now remove the member's explicit row via the same action path the
      // settings UI calls — this is the AS-225 assertion itself: their
      // very next request must return zero rows, not an error, and not a
      // stale/cached "still visible" result.
      const removeResult = await removeProjectMember(projectId, memberUserId);
      expect(removeResult.ok).toBe(true);

      const { data: afterRemoval, error: afterRemovalErr } = await memberClient
        .from("projects")
        .select("id")
        .eq("id", projectId);
      expect(afterRemovalErr).toBeNull();
      expect(afterRemoval).toEqual([]);

      const { data: taskAfterRemoval, error: taskAfterRemovalErr } = await memberClient
        .from("tasks")
        .select("id")
        .eq("id", taskId);
      expect(taskAfterRemovalErr).toBeNull();
      expect(taskAfterRemoval).toEqual([]);
    });

    it("AS-229 (negative, this feature's own action): a plain member CANNOT change the project's visibility via updateProjectVisibility", async () => {
      currentSessionClient = memberSessionClient;
      const result = await updateProjectVisibility(projectId, "workspace");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "Only workspace owners or admins can change a project's visibility.",
        );
      }

      const { data: unchanged } = await adminClient
        .from("projects")
        .select("visibility")
        .eq("id", projectId)
        .single();
      expect(unchanged?.visibility).toBe("private");
    });
  },
);
