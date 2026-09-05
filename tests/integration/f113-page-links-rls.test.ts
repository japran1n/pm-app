// Integration test for F113 (missions/20260903-portal,
// docs/client-portal-phase-2-plan.md item B): `page_links`, the per-page
// sibling of `project_links` (20261101020000). Same convention as
// tests/integration/f022-links-accounts-docs-visibility-rls.test.ts: real
// signed-in sessions against PostgREST, not a mocked query builder.
//
// Covers, per this feature's own "never weaken a test" instruction:
//   - the cross-project RLS case: a client on project B must never read a
//     page link belonging to a page on project A, even by direct id;
//   - a page link on a task that itself is NOT client_visible must not
//     leak, even if the link row's own client_visible is true;
//   - the credential-shape URL rejection, shared with project_links via
//     `looks_like_credential`;
//   - a page with no links at all (the "vacuously true, nothing to leak"
//     empty case).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";
const RLS_DENIED = "42501";
const CHECK_VIOLATION = "23514";

describe.skipIf(!haveCreds)("page_links", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;
  let otherClientSession: SupabaseClient;

  let workspaceId: string;
  let projectAId: string; // portal-enabled, clientSession's own project
  let projectBId: string; // portal-enabled, otherClientSession's own project
  let ownerId: string;
  let memberId: string;
  let clientId: string;
  let otherClientId: string;

  let pageTaskId: string; // client_visible task on project A
  let hiddenTaskId: string; // NOT client_visible task on project A
  let emptyPageTaskId: string; // client_visible task on project A, no links

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f113-page-links-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientUser = await makeUser("client");
    const otherClientUser = await makeUser("other-client");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;
    otherClientId = otherClientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F113 page links test", slug: `f113-page-links-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: otherClientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectAId = await insertProject("Project A");
    projectBId = await insertProject("Project B");

    await admin.from("project_members").insert([
      { project_id: projectAId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectBId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectBId, user_id: otherClientId, project_role: "member", added_by: ownerId },
    ]);

    const insertTask = async (projectId: string, title: string, clientVisible: boolean) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          status: "todo",
          author_id: ownerId,
          client_visible: clientVisible,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
      return data.id as string;
    };

    pageTaskId = await insertTask(projectAId, "About", true);
    hiddenTaskId = await insertTask(projectAId, "Internal draft page", false);
    emptyPageTaskId = await insertTask(projectAId, "Careers", true);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    memberSession = await signIn(memberUser.email);
    clientSession = await signIn(clientUser.email);
    otherClientSession = await signIn(otherClientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("page_links").delete().in("task_id", [pageTaskId, hiddenTaskId, emptyPageTaskId]);
    await admin.from("tasks").delete().in("id", [pageTaskId, hiddenTaskId, emptyPageTaskId]);
    await admin.from("project_members").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("projects").delete().in("id", [projectAId, projectBId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  describe("shared kind vocabulary and the credential guard", () => {
    it("rejects a kind outside the closed vocabulary shared with project_links", async () => {
      const { error } = await admin.from("page_links").insert({
        task_id: pageTaskId,
        kind: "not_a_real_kind",
        label: "Bad kind",
        url: "https://example.com",
        position: 99,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    // AS-113 (this feature's own): a basic-auth-shaped/credential-shaped
    // URL is rejected the same way project_accounts already rejects a
    // credential-shaped service/note.
    const secretShapeUrls = [
      "https://user:sk_live_51H8x9yzABCDEFGHIJ1234567890@staging.example.com",
      "https://staging.example.com/?token=ghp_1234567890abcdefghijklmnopqrstuv",
      "https://staging.example.com/#-----BEGIN PRIVATE KEY-----",
    ];

    it.each(secretShapeUrls)("rejects a credential-shaped url: %s", async (url) => {
      const { error } = await admin.from("page_links").insert({
        task_id: pageTaskId,
        kind: "staging",
        label: "Suspicious",
        url,
        position: 98,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });
  });

  describe("RLS", () => {
    let visibleLinkId: string;
    let hiddenLinkId: string;
    let linkOnHiddenTaskId: string;
    let crossProjectLinkId: string;

    beforeAll(async () => {
      const { data: visible, error: visibleErr } = await admin
        .from("page_links")
        .insert({
          task_id: pageTaskId,
          kind: "staging",
          label: "About — staging",
          url: "https://staging.example.com/about",
          client_visible: true,
          position: 1,
        })
        .select("id")
        .single();
      if (visibleErr || !visible) throw new Error(`link: ${visibleErr?.message}`);
      visibleLinkId = visible.id;

      const { data: hidden, error: hiddenErr } = await admin
        .from("page_links")
        .insert({
          task_id: pageTaskId,
          kind: "figma",
          label: "About — Figma frame",
          url: "https://figma.com/file/about",
          position: 2,
        })
        .select("id, client_visible")
        .single();
      if (hiddenErr || !hidden) throw new Error(`link: ${hiddenErr?.message}`);
      hiddenLinkId = hidden.id;
      // Same default as project_links: a link added without an explicit
      // client_visible value defaults to false.
      expect(hidden.client_visible).toBe(false);

      // client_visible = true on the LINK, but the parent TASK itself is
      // not client-visible -- this must still not leak to the client.
      const { data: onHidden, error: onHiddenErr } = await admin
        .from("page_links")
        .insert({
          task_id: hiddenTaskId,
          kind: "staging",
          label: "Internal draft — staging",
          url: "https://staging.example.com/internal-draft",
          client_visible: true,
          position: 1,
        })
        .select("id")
        .single();
      if (onHiddenErr || !onHidden) throw new Error(`link: ${onHiddenErr?.message}`);
      linkOnHiddenTaskId = onHidden.id;

      // A page link that belongs to a DIFFERENT project's task -- the
      // cross-project case this feature's own instruction calls out.
      const { data: otherProjectTask, error: otherTaskErr } = await admin
        .from("tasks")
        .insert({
          project_id: projectBId,
          title: "Project B page",
          status: "todo",
          author_id: ownerId,
          client_visible: true,
        })
        .select("id")
        .single();
      if (otherTaskErr || !otherProjectTask) throw new Error(`task: ${otherTaskErr?.message}`);

      const { data: crossProjectLink, error: crossErr } = await admin
        .from("page_links")
        .insert({
          task_id: otherProjectTask.id,
          kind: "staging",
          label: "Project B — staging",
          url: "https://staging.example.com/project-b",
          client_visible: true,
          position: 1,
        })
        .select("id")
        .single();
      if (crossErr || !crossProjectLink) throw new Error(`link: ${crossErr?.message}`);
      crossProjectLinkId = crossProjectLink.id;
    });

    it("a client on the same project reads only the client-visible link on a client-visible page", async () => {
      const { data, error } = await clientSession
        .from("page_links")
        .select("id")
        .eq("task_id", pageTaskId);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([visibleLinkId]);
    });

    it("a client cannot fetch the hidden link on their own page by direct id either", async () => {
      const { data, error } = await clientSession
        .from("page_links")
        .select("id")
        .eq("id", hiddenLinkId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a client-visible link on a NOT client-visible task does not leak", async () => {
      const { data, error } = await clientSession
        .from("page_links")
        .select("id")
        .eq("id", linkOnHiddenTaskId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // The RLS failure case this feature's own instruction says to write
    // first: a client of project A must never read project B's page
    // links, by direct id or by any other route.
    it("cross-project: a client on project A cannot read project B's page link, even by direct id", async () => {
      const { data, error } = await clientSession
        .from("page_links")
        .select("id")
        .eq("id", crossProjectLinkId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cross-project: project A's client session sees nothing when querying project B's task", async () => {
      const { data: otherProjectTask } = await admin
        .from("tasks")
        .select("id")
        .eq("project_id", projectBId)
        .eq("title", "Project B page")
        .single();
      const { data, error } = await clientSession
        .from("page_links")
        .select("id")
        .eq("task_id", otherProjectTask!.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("project B's own client reads their own project's page link", async () => {
      const { data, error } = await otherClientSession
        .from("page_links")
        .select("id")
        .eq("id", crossProjectLinkId);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([crossProjectLinkId]);
    });

    it("a team member reads every link on the project, including hidden ones", async () => {
      const { data, error } = await memberSession
        .from("page_links")
        .select("id")
        .eq("task_id", pageTaskId);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id).sort()).toEqual(
        [visibleLinkId, hiddenLinkId].sort(),
      );
    });

    it("a page with no links returns an empty list for both team and client", async () => {
      const [teamResult, clientResult] = await Promise.all([
        memberSession.from("page_links").select("id").eq("task_id", emptyPageTaskId),
        clientSession.from("page_links").select("id").eq("task_id", emptyPageTaskId),
      ]);
      expect(teamResult.error).toBeNull();
      expect(teamResult.data).toEqual([]);
      expect(clientResult.error).toBeNull();
      expect(clientResult.data).toEqual([]);
    });

    it("a client has no INSERT/UPDATE/DELETE path", async () => {
      const insert = await clientSession.from("page_links").insert({
        task_id: pageTaskId,
        kind: "other",
        label: "Client-authored",
        url: "https://example.com",
        position: 3,
      });
      expect(insert.error?.code).toBe(RLS_DENIED);

      const { data: updated, error: updateErr } = await clientSession
        .from("page_links")
        .update({ label: "Hijacked" })
        .eq("id", visibleLinkId)
        .select("id");
      expect(updateErr).toBeNull();
      expect(updated).toEqual([]);

      const { data: deleted, error: deleteErr } = await clientSession
        .from("page_links")
        .delete()
        .eq("id", visibleLinkId)
        .select("id");
      expect(deleteErr).toBeNull();
      expect(deleted).toEqual([]);
    });

    it("a team member can insert, update and delete a page link", async () => {
      const { data: inserted, error: insertErr } = await memberSession
        .from("page_links")
        .insert({
          task_id: pageTaskId,
          kind: "live",
          label: "About — live",
          url: "https://www.example.com/about",
          position: 3,
        })
        .select("id")
        .single();
      expect(insertErr).toBeNull();
      expect(inserted).not.toBeNull();

      const { error: updateErr } = await memberSession
        .from("page_links")
        .update({ label: "About — live site" })
        .eq("id", inserted!.id);
      expect(updateErr).toBeNull();

      const { error: deleteErr } = await memberSession
        .from("page_links")
        .delete()
        .eq("id", inserted!.id);
      expect(deleteErr).toBeNull();
    });
  });
});
