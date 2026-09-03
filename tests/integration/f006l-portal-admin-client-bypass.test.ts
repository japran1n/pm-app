// Integration test for F006l (missions/20260903-portal, M1 remediation,
// round 3 — B3/B4): `addComment` (lib/actions/comments.ts) and
// `getAttachmentSignedUrl` (lib/actions/attachments.ts) both insert/read
// through the service-role ADMIN client, so the gated RLS policies
// (comments_insert_active_members, attachments_objects_select_active_members
// via is_task_visible_to) never run for these paths. Both actions already
// checked `client_visible`; neither checked `portal_enabled`.
//
// Same mocking convention as tests/integration/add-comment.test.ts and
// tests/integration/f323-sibling-action-project-visibility.test.ts: only
// `@/lib/supabase/server`'s `createClient()` is mocked (to resolve
// `auth.getUser()` to a real throwaway Supabase Auth user); everything
// else runs against the real linked Supabase project.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F006l: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentTestUserId ? { id: currentTestUserId } : null },
      }),
    },
    channel: () => ({ send: async () => {} }),
    removeChannel: async () => {},
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "F006l: addComment / getAttachmentSignedUrl reject a client of a portal-disabled project (AS-007, B3/B4)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdCommentIds: string[] = [];
    const createdAttachmentIds: string[] = [];
    const createdObjectPaths: string[] = [];
    let workspaceId: string;
    let enabledProjectId: string;
    let disabledProjectId: string;
    let clientUserId: string;
    let ownerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F006l Bypass Workspace", slug: `f006l-bypass-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { data: clientAuth, error: clientAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f006l-bypass-client-${suffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (clientAuthErr || !clientAuth.user) {
        throw new Error(`client user: ${clientAuthErr?.message}`);
      }
      clientUserId = clientAuth.user.id;

      const { data: ownerAuth, error: ownerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f006l-bypass-owner-${suffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`owner user: ${ownerAuthErr?.message}`);
      }
      ownerUserId = ownerAuth.user.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: clientUserId, role: "client", status: "active" },
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
      ]);
      if (memberErr) throw new Error(`membership: ${memberErr.message}`);

      const { data: enabledProject, error: enabledErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F006l Enabled", portal_enabled: true })
        .select("id")
        .single();
      if (enabledErr || !enabledProject) throw new Error(`enabled project: ${enabledErr?.message}`);
      enabledProjectId = enabledProject.id;

      const { data: disabledProject, error: disabledErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F006l Disabled", portal_enabled: false })
        .select("id")
        .single();
      if (disabledErr || !disabledProject) throw new Error(`disabled project: ${disabledErr?.message}`);
      disabledProjectId = disabledProject.id;
    });

    afterAll(async () => {
      for (const path of createdObjectPaths) {
        await adminClient.storage.from("task-attachments").remove([path]);
      }
      await adminClient.from("projects").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
      if (clientUserId) await adminClient.auth.admin.deleteUser(clientUserId);
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    async function makeClientVisibleTask(projectId: string): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F006l task", status: "todo", client_visible: true, author_id: ownerUserId })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task: ${error?.message}`);
      createdTaskIds.push(data.id);
      return data.id;
    }

    async function makeAttachment(taskId: string): Promise<string> {
      const objectPath = `${taskId}/f006l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`;
      const { error: storageError } = await adminClient.storage
        .from("task-attachments")
        .upload(objectPath, new TextEncoder().encode("hello"), { contentType: "text/plain", upsert: false });
      if (storageError) throw new Error(`storage upload: ${storageError.message}`);
      createdObjectPaths.push(objectPath);

      const { data, error } = await adminClient
        .from("attachments")
        .insert({ task_id: taskId, file_url: objectPath, file_name: "f006l.txt", mime_type: "text/plain", uploaded_by: ownerUserId })
        .select("id")
        .single();
      if (error || !data) throw new Error(`attachment: ${error?.message}`);
      createdAttachmentIds.push(data.id);
      return data.id;
    }

    describe("addComment (B3)", () => {
      it("AS-007/B3: a client of a portal-disabled project cannot post a comment on a client_visible task, called directly", async () => {
        const { addComment } = await import("@/lib/actions/comments");
        const taskId = await makeClientVisibleTask(disabledProjectId);

        currentTestUserId = clientUserId;
        const result = await addComment(taskId, "Trying to comment while portal is off");

        expect(result.ok).toBe(false);

        const { data: comments } = await adminClient
          .from("comments")
          .select("id")
          .eq("task_id", taskId);
        expect(comments).toEqual([]);
      });

      it("AS-007/B3 regression: the same client CAN comment once the project's portal is enabled", async () => {
        const { addComment } = await import("@/lib/actions/comments");
        const taskId = await makeClientVisibleTask(enabledProjectId);

        currentTestUserId = clientUserId;
        const result = await addComment(taskId, "Portal is on, this should land");

        expect(result.ok).toBe(true);
        if (result.ok) createdCommentIds.push(result.data.id);
      });
    });

    describe("getAttachmentSignedUrl (B4)", () => {
      it("AS-007/B4: a client of a portal-disabled project cannot mint a signed URL for a client_visible attachment, called directly", async () => {
        const { getAttachmentSignedUrl } = await import("@/lib/actions/attachments");
        const taskId = await makeClientVisibleTask(disabledProjectId);
        const attachmentId = await makeAttachment(taskId);

        currentTestUserId = clientUserId;
        const result = await getAttachmentSignedUrl(attachmentId);

        expect(result.ok).toBe(false);
      });

      it("AS-007/B4 regression: the same client CAN mint a signed URL once the project's portal is enabled", async () => {
        const { getAttachmentSignedUrl } = await import("@/lib/actions/attachments");
        const taskId = await makeClientVisibleTask(enabledProjectId);
        const attachmentId = await makeAttachment(taskId);

        currentTestUserId = clientUserId;
        const result = await getAttachmentSignedUrl(attachmentId);

        expect(result.ok).toBe(true);
      });
    });
  },
);
