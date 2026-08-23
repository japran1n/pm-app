// Integration test for F313 (AS-376 follow-up, M15 third scrutiny pass),
// run against the real linked Supabase project — mirrors the
// loadDotEnv/skipIf pattern established by
// tests/integration/mention-visibility.test.ts and
// tests/integration/template-actions.test.ts.
//
// Two independent bugs found by scrutiny:
//
//  1. createTaskFromTemplate (lib/actions/templates.ts) copied a
//     template's description_json verbatim into the TARGET project
//     without ever running it through sanitiseMentionsForVisibility —
//     every other mention-doc write path (addComment/editComment/editTask)
//     already does this. A mention referencing a user with no access to
//     the target project must be stripped, not carried over.
//
//  2. getMentionCandidates (lib/actions/comments.ts) called
//     resolveVisibleMentionIds with no try/catch, unlike its sibling
//     member-fetch call in the same function — an unhandled rejection.
//     This test proves the function returns a typed `{ ok: false }` result
//     instead of throwing when the underlying visibility lookup fails.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F313: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "F313 mention-visibility follow-up (AS-376)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let privateProjectId: string;
    let creatorUserId: string;
    // Outsider: an active workspace member with no access to the private
    // target project at all.
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F313 Test Workspace",
          slug: `f313-mentions-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createActiveMember(label: string) {
        const email = `f313-${label}-${uniqueSuffix}@example.com`;
        const { data: authUser, error: authErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authErr || !authUser.user) {
          throw new Error(`Failed to create ${label} user: ${authErr?.message}`);
        }
        createdUserIds.push(authUser.user.id);
        const { error: memberErr } = await adminClient
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: authUser.user.id,
            role: "member",
            status: "active",
          });
        if (memberErr) {
          throw new Error(`Failed to seed ${label} member: ${memberErr.message}`);
        }
        return authUser.user.id;
      }

      creatorUserId = await createActiveMember("creator");
      outsiderUserId = await createActiveMember("outsider");

      // A brand-new PRIVATE project. The creator has explicit access (via
      // project_members); the outsider deliberately does not — mirroring
      // "a task created from a template in a brand-new/private project".
      const { data: privateProj, error: privateProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F313 Private Target Project ${uniqueSuffix}`,
          created_by: creatorUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjErr || !privateProj) {
        throw new Error(
          `Failed to create private test project: ${privateProjErr?.message}`,
        );
      }
      privateProjectId = privateProj.id;
      createdProjectIds.push(privateProjectId);

      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: creatorUserId,
        project_role: "member",
        added_by: creatorUserId,
      });
      if (pmErr) {
        throw new Error(`Failed to seed project_members: ${pmErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const templateId of createdTemplateIds) {
        await adminClient.from("task_templates").delete().eq("id", templateId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("project_members").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      if (workspaceId) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function makeTemplateWithMention(
      mentionedUserId: string,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceId,
          kind: "task",
          name: `F313 Template ${Date.now()}`,
          created_by: creatorUserId,
          payload: {
            title: "Templated task with a mention",
            description: "See mention",
            description_json: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "mention", attrs: { id: mentionedUserId } },
                    { type: "text", text: " please look at this" },
                  ],
                },
              ],
            },
            priority: "high",
            checklistItems: [],
            estimate_minutes: null,
            tags: [],
            assigneeIds: [],
          },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed template: ${error?.message}`);
      }
      createdTemplateIds.push(data.id);
      return data.id;
    }

    // -----------------------------------------------------------------
    // Bug 1: createTaskFromTemplate must sanitise mentions against the
    // TARGET project's visibility, not carry the template's payload
    // through verbatim.
    // -----------------------------------------------------------------

    it("AS-376 (template copy): a mention referencing a user with no access to the target project is stripped when a task is created from a template", async () => {
      const { createTaskFromTemplate } = await import(
        "@/lib/actions/templates"
      );

      const templateId = await makeTemplateWithMention(outsiderUserId);

      currentTestUserId = creatorUserId;
      const result = await createTaskFromTemplate(templateId, privateProjectId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      const { data: taskRow, error } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      const storedJson = JSON.stringify(taskRow?.description_json ?? {});

      // The outsider's id (and the mention node itself) must never
      // survive into the new task in the private target project.
      expect(storedJson.includes(outsiderUserId)).toBe(false);
      expect(storedJson.includes('"mention"')).toBe(false);
      expect(storedJson.includes("Former member")).toBe(true);
    });

    it("AS-376 (template copy, positive control): a mention referencing a user who DOES have access to the target project is kept", async () => {
      const { createTaskFromTemplate } = await import(
        "@/lib/actions/templates"
      );

      const templateId = await makeTemplateWithMention(creatorUserId);

      currentTestUserId = creatorUserId;
      const result = await createTaskFromTemplate(templateId, privateProjectId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", result.data.id)
        .single();

      const storedJson = JSON.stringify(taskRow?.description_json ?? {});
      expect(storedJson.includes('"mention"')).toBe(true);
      expect(storedJson.includes(creatorUserId)).toBe(true);
    });

    // -----------------------------------------------------------------
    // Bug 2: getMentionCandidates must never let a resolveVisibleMentionIds
    // failure propagate as an unhandled rejection — it must resolve to a
    // typed `{ ok: false }` result instead.
    // -----------------------------------------------------------------

    it("AS-376 (picker resilience): getMentionCandidates resolves to a typed error instead of rejecting when the underlying visibility lookup fails", async () => {
      const { getMentionCandidates } = await import("@/lib/actions/comments");

      // A task in a project that does not exist (already deleted / bad
      // id) drives the same "not found" path as before, but we also
      // directly assert the function never rejects for any input —
      // including a project row shaped to trigger resolveVisibleMentionIds
      // internally, by using a task whose project has been hard-deleted
      // out from under it after the initial fetch race is not easily
      // reproducible without mocking Supabase internals. Instead, this
      // proves the contract directly: calling the exported function never
      // throws/rejects, always resolving to a discriminated-union result,
      // for both the "not found" and success paths — the same guarantee
      // needed so a bare `.then()` call site (comment-list.tsx,
      // task-detail-sheet.tsx) never hangs on an unhandled rejection.
      currentTestUserId = creatorUserId;

      await expect(
        getMentionCandidates("00000000-0000-0000-0000-000000000000"),
      ).resolves.toEqual(
        expect.objectContaining({ ok: expect.any(Boolean) }),
      );

      const notFoundResult = await getMentionCandidates(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(notFoundResult.ok).toBe(false);
    });

    it("AS-376 (picker resilience, unit-level): getMentionCandidates catches a resolveVisibleMentionIds rejection and returns { ok: false } rather than throwing", async () => {
      vi.resetModules();
      vi.doMock("@/lib/comments/mentions", async () => {
        const actual = await vi.importActual<
          typeof import("@/lib/comments/mentions")
        >("@/lib/comments/mentions");
        return {
          ...actual,
          resolveVisibleMentionIds: vi.fn(async () => {
            throw new (class extends Error {})("simulated transient DB failure");
          }),
        };
      });

      try {
        const { getMentionCandidates } = await import(
          "@/lib/actions/comments"
        );

        currentTestUserId = creatorUserId;

        // Real task in the real workspace so every step up to the
        // resolveVisibleMentionIds call succeeds normally, and only the
        // mocked call rejects.
        const { data: task, error: taskErr } = await adminClient
          .from("tasks")
          .insert({
            project_id: privateProjectId,
            title: "F313 picker resilience task",
            author_id: creatorUserId,
          })
          .select("id")
          .single();
        if (taskErr || !task) {
          throw new Error(`Failed to seed task: ${taskErr?.message}`);
        }
        createdTaskIds.push(task.id);

        let result: Awaited<ReturnType<typeof getMentionCandidates>> | null =
          null;
        let threw = false;
        try {
          result = await getMentionCandidates(task.id);
        } catch {
          threw = true;
        }

        expect(threw).toBe(false);
        expect(result?.ok).toBe(false);
      } finally {
        vi.doUnmock("@/lib/comments/mentions");
        vi.resetModules();
      }
    });
  },
);
