// Integration test for F008 (missions/20260903-portal, M2 — Approvals):
// requestApproval / withdrawApproval / getDecisionOwnersForDialog /
// setDecisionOwner (lib/actions/approvals.ts). Covers AS-019, AS-020.
//
// Driven through real signed-in sessions calling the actual Server
// Actions against the real linked Supabase project — mirrors
// tests/integration/f002-phase-management.test.ts's
// loadDotEnv/real-signed-in-client/mocked-createClient pattern.
// `createAdminClient()` (lib/supabase/admin.ts) reads
// NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY straight from process.env
// (populated by loadDotEnv below) and is never mocked — the action's own
// `ctx.admin` writes are exercised for real, same as f002's own tests.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F008: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    // Non-fatal in the action itself (try/catch'd) — thrown here on
    // purpose to prove that catch actually runs, same convention as
    // f002-phase-management.test.ts.
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveCreds)(
  "F008 requestApproval / withdrawApproval / getDecisionOwnersForDialog / setDecisionOwner (AS-019, AS-020)",
  () => {
    let adminClient: SupabaseClient;

    let workspaceId: string;
    let projectId: string;
    let ownerId: string;
    let clientId: string;

    let visibleTaskId: string;
    let hiddenTaskId: string;
    let docId: string;

    let ownerEmail: string;
    let viewerEmail: string;

    const createdUserIds: string[] = [];

    async function signInAs(email: string) {
      const signInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await signInClient.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
      currentTestClient = signInClient as unknown as typeof currentTestClient;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: `f008-approvals-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const clientUser = await makeUser("client");
      const viewerUser = await makeUser("viewer");
      ownerId = owner.id;
      ownerEmail = owner.email;
      clientId = clientUser.id;
      viewerEmail = viewerUser.email;

      const { data: workspace, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F008 approvals test", slug: `f008-approvals-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUser.id, role: "viewer", status: "active" },
      ]);

      const { data: project, error: projectError } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F008 project",
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

      const insertTask = async (title: string, clientVisible: boolean) => {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title,
            status: "todo",
            author_id: ownerId,
            client_visible: clientVisible,
            description: "Task body for snapshot capture.",
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
        return data.id as string;
      };

      visibleTaskId = await insertTask("Homepage moodboard", true);
      hiddenTaskId = await insertTask("Internal: pricing notes", false);

      const { data: doc, error: docError } = await adminClient
        .from("docs")
        .insert({
          workspace_id: workspaceId,
          project_id: projectId,
          title: "Sitemap v1",
          content: "# Sitemap\n\nHome, About, Contact.",
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (docError || !doc) throw new Error(`doc: ${docError?.message}`);
      docId = doc.id;

      // Only 'content' has a named owner — 'brand' deliberately has none,
      // for the "no owner" failure test.
      await adminClient.from("project_decision_owners").insert({
        project_id: projectId,
        decision_type: "content",
        user_id: clientId,
      });
    }, 60_000);

    afterAll(async () => {
      if (!adminClient) return;
      // Storage cleanup: remove every snapshot object this suite's own
      // approval_requests rows might have written, keyed by request id —
      // read the paths before the rows are deleted below.
      const { data: snapshotRows } = await adminClient
        .from("approval_requests")
        .select("artifact_snapshot_path")
        .eq("project_id", projectId)
        .not("artifact_snapshot_path", "is", null);
      const snapshotPaths = (snapshotRows ?? [])
        .map((row) => row.artifact_snapshot_path)
        .filter((path): path is string => Boolean(path));
      if (snapshotPaths.length > 0) {
        await adminClient.storage.from("task-attachments").remove(snapshotPaths);
      }

      await adminClient.from("approval_requests").delete().eq("project_id", projectId);
      await adminClient.from("project_decision_owners").delete().eq("project_id", projectId);
      await adminClient.from("docs").delete().eq("workspace_id", workspaceId);
      await adminClient.from("tasks").delete().eq("project_id", projectId);
      await adminClient.from("projects").delete().eq("id", projectId);
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await adminClient.auth.admin.deleteUser(id);
    }, 60_000);

    // --- AS-019 ----------------------------------------------------------

    describe("AS-019: a team member can create an approval request from a task, a doc, or an artifact URL", () => {
      it("from a task", async () => {
        await signInAs(ownerEmail);
        const { requestApproval } = await import("@/lib/actions/approvals");

        const result = await requestApproval({
          projectId,
          subjectType: "task",
          subjectId: visibleTaskId,
          title: "Approve homepage moodboard",
          decisionType: "content",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.subjectType).toBe("task");

        const { data: row } = await adminClient
          .from("approval_requests")
          .select("subject_type, subject_id, title, description, artifact_snapshot_path")
          .eq("id", result.data.id)
          .single();
        expect(row?.subject_type).toBe("task");
        expect(row?.subject_id).toBe(visibleTaskId);
        expect(row?.artifact_snapshot_path).toBeNull();
      });

      it("from a doc, capturing the doc's current body at a storage path", async () => {
        await signInAs(ownerEmail);
        const { requestApproval } = await import("@/lib/actions/approvals");

        const result = await requestApproval({
          projectId,
          subjectType: "doc",
          subjectId: docId,
          title: "Approve sitemap",
          decisionType: "content",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.subjectType).toBe("doc");

        const { data: row } = await adminClient
          .from("approval_requests")
          .select("subject_type, subject_id, artifact_snapshot_path")
          .eq("id", result.data.id)
          .single();
        expect(row?.subject_type).toBe("doc");
        expect(row?.artifact_snapshot_path).toBe(`approval-requests/${result.data.id}/doc-snapshot.md`);

        const { data: fileData, error: downloadError } = await adminClient.storage
          .from("task-attachments")
          .download(row!.artifact_snapshot_path!);
        expect(downloadError).toBeNull();
        const text = await fileData?.text();
        expect(text).toContain("Sitemap");
      });

      it("standalone, with an external artifact URL — never fetched server-side", async () => {
        await signInAs(ownerEmail);
        const { requestApproval } = await import("@/lib/actions/approvals");

        const result = await requestApproval({
          projectId,
          subjectType: "artifact",
          artifactUrl: "https://www.figma.com/file/abc123/moodboard",
          title: "Approve Figma moodboard",
          decisionType: "content",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.subjectType).toBe("artifact");

        const { data: row } = await adminClient
          .from("approval_requests")
          .select("subject_type, subject_id, artifact_url, artifact_snapshot_path, requested_at")
          .eq("id", result.data.id)
          .single();
        expect(row?.subject_type).toBe("artifact");
        expect(row?.subject_id).toBeNull();
        expect(row?.artifact_url).toBe("https://www.figma.com/file/abc123/moodboard");
        expect(row?.artifact_snapshot_path).toBeNull();
        expect(row?.requested_at).toBeTruthy();
      });

      it("a viewer cannot request an approval (canWrite gate)", async () => {
        await signInAs(viewerEmail);
        const { requestApproval } = await import("@/lib/actions/approvals");

        const result = await requestApproval({
          projectId,
          subjectType: "task",
          subjectId: visibleTaskId,
          title: "Should be blocked",
          decisionType: "content",
        });

        expect(result.ok).toBe(false);
      });
    });

    // --- AS-020 ------------------------------------------------------------

    it("AS-020: creating an approval request against a task that is not client-visible is rejected at creation time with an explicit error, and writes no row", async () => {
      await signInAs(ownerEmail);
      const { requestApproval } = await import("@/lib/actions/approvals");

      const { count: before } = await adminClient
        .from("approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("subject_id", hiddenTaskId);

      const result = await requestApproval({
        projectId,
        subjectType: "task",
        subjectId: hiddenTaskId,
        title: "Should be rejected",
        decisionType: "content",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/share with client/i);

      const { count: after } = await adminClient
        .from("approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("subject_id", hiddenTaskId);

      expect(after).toBe(before);

      // AS-020 rejection never silently flips the task visible.
      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("client_visible")
        .eq("id", hiddenTaskId)
        .single();
      expect(taskRow?.client_visible).toBe(false);
    });

    // --- Definition of done: a decision type with no owner is blocked -----

    it("raising a request for a decision type with no project_decision_owners row is blocked with a message naming the gap, and writes no row", async () => {
      await signInAs(ownerEmail);
      const { requestApproval } = await import("@/lib/actions/approvals");

      const { count: before } = await adminClient
        .from("approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("decision_type", "brand");

      const result = await requestApproval({
        projectId,
        subjectType: "task",
        subjectId: visibleTaskId,
        title: "No owner for brand",
        decisionType: "brand",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/no one is set up to approve brand/i);

      const { count: after } = await adminClient
        .from("approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("decision_type", "brand");
      expect(after).toBe(before);
    });

    // --- getDecisionOwnersForDialog -----------------------------------

    it("getDecisionOwnersForDialog names the content decision owner and omits brand", async () => {
      await signInAs(ownerEmail);
      const { getDecisionOwnersForDialog } = await import("@/lib/actions/approvals");

      const result = await getDecisionOwnersForDialog(projectId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const content = result.data.owners.find((owner) => owner.decisionType === "content");
      expect(content?.userId).toBe(clientId);
      const brand = result.data.owners.find((owner) => owner.decisionType === "brand");
      expect(brand).toBeUndefined();
    });

    // --- setDecisionOwner -----------------------------------------------

    it("setDecisionOwner assigns a client member as the technical decision owner", async () => {
      await signInAs(ownerEmail);
      const { setDecisionOwner, getDecisionOwnersForDialog } = await import("@/lib/actions/approvals");

      const result = await setDecisionOwner(projectId, "technical", clientId);
      expect(result.ok).toBe(true);

      const owners = await getDecisionOwnersForDialog(projectId);
      expect(owners.ok).toBe(true);
      if (!owners.ok) return;
      const technical = owners.data.owners.find((owner) => owner.decisionType === "technical");
      expect(technical?.userId).toBe(clientId);
    });

    it("setDecisionOwner rejects a non-client user", async () => {
      await signInAs(ownerEmail);
      const { setDecisionOwner } = await import("@/lib/actions/approvals");

      const result = await setDecisionOwner(projectId, "commercial", ownerId);
      expect(result.ok).toBe(false);
    });

    // --- withdrawApproval --------------------------------------------------

    it("withdrawApproval transitions a pending request to withdrawn, and rejects a second withdraw", async () => {
      await signInAs(ownerEmail);
      const { requestApproval, withdrawApproval } = await import("@/lib/actions/approvals");

      const created = await requestApproval({
        projectId,
        subjectType: "artifact",
        artifactUrl: "https://www.figma.com/file/def456/withdraw-me",
        title: "Withdraw me",
        decisionType: "content",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const withdrawn = await withdrawApproval(created.data.id);
      expect(withdrawn.ok).toBe(true);

      const { data: row } = await adminClient
        .from("approval_requests")
        .select("state")
        .eq("id", created.data.id)
        .single();
      expect(row?.state).toBe("withdrawn");

      const secondWithdraw = await withdrawApproval(created.data.id);
      expect(secondWithdraw.ok).toBe(false);
    });
  },
);
