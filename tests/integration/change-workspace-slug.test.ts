// Integration test for F137 (AS-241: "URLs using the old slug redirect to
// the new one instead of 404ing" / AS-242: "a slug already in use is
// rejected with a specific error"), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf and server-client mocking
// pattern established by tests/integration/rename-workspace.test.ts and
// tests/integration/delete-workspace.test.ts.
//
// AS-241 methodology note: the workspace layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) is a Server Component
// that needs a live Next.js request/cookie context to render, so — per the
// established convention in tests/integration/workspace-not-found-scope.
// test.ts (F023/AS-144) — it isn't unit-rendered here either. Instead,
// after actually changing a slug via `changeWorkspaceSlug`, this test runs
// the EXACT three-query sequence the layout performs when a slug lookup
// misses (workspace-by-slug -> slug-history-by-old-slug ->
// current-workspace-by-id), against the real database, and asserts it
// resolves to the workspace's NEW slug. That is what proves a request for
// the OLD slug's URL path would be redirected to the new one instead of
// 404ing, not merely that a history row exists (an unused/dead history row
// would also "exist" without proving anything about the redirect path
// actually working end to end).

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
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

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
  "changeWorkspaceSlug (F137: AS-241, AS-242)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(() => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const workspaceId of createdWorkspaceIds) {
        await adminClient
          .from("workspace_slug_history")
          .delete()
          .eq("workspace_id", workspaceId);
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

    function uniqueSuffix() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function createThrowawayUser(prefix: string) {
      const suffix = uniqueSuffix();
      const { data, error } = await adminClient.auth.admin.createUser({
        email: `f137-${prefix}-${suffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create test user: ${error?.message}`);
      }
      createdUserIds.push(data.user.id);
      return data.user.id;
    }

    async function createWorkspace(slugPrefix = "f137") {
      const suffix = uniqueSuffix();
      const { data: workspace, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: `F137 test ${suffix}`,
          slug: `${slugPrefix}-${suffix}`,
        })
        .select("id, slug")
        .single();
      if (wsErr || !workspace) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      createdWorkspaceIds.push(workspace.id);
      return workspace as { id: string; slug: string };
    }

    async function seedMember(
      workspaceId: string,
      role: "owner" | "admin" | "member" | "guest",
    ) {
      const userId = await createThrowawayUser(role);
      const { error } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role,
        status: "active",
      });
      if (error) {
        throw new Error(`Failed to seed ${role} membership: ${error.message}`);
      }
      return userId;
    }

    it("AS-241: an owner can change a workspace's slug, and a workspace_slug_history row records the retired slug", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspace = await createWorkspace();
      currentTestUserId = await seedMember(workspace.id, "owner");
      const oldSlug = workspace.slug;
      const newSlug = `f137-renamed-${uniqueSuffix()}`;

      const result = await changeWorkspaceSlug(workspace.id, newSlug);

      expect(result).toEqual({ ok: true, data: { slug: newSlug } });

      const { data: workspaceRow } = await adminClient
        .from("workspaces")
        .select("slug")
        .eq("id", workspace.id)
        .maybeSingle();
      expect(workspaceRow?.slug).toBe(newSlug);

      const { data: historyRow } = await adminClient
        .from("workspace_slug_history")
        .select("workspace_id")
        .eq("old_slug", oldSlug)
        .maybeSingle();
      expect(historyRow?.workspace_id).toBe(workspace.id);
    });

    it("AS-241: hitting the OLD slug's URL path resolves (via the layout's exact redirect query chain) to the new slug, not a 404", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspace = await createWorkspace();
      currentTestUserId = await seedMember(workspace.id, "owner");
      const oldSlug = workspace.slug;
      const newSlug = `f137-redirect-target-${uniqueSuffix()}`;

      const changeResult = await changeWorkspaceSlug(workspace.id, newSlug);
      expect(changeResult.ok).toBe(true);

      // Step 1 of the layout: look up the workspace by the incoming
      // (now-stale) slug — must miss, exactly like a genuinely unknown
      // slug would (this is the branch that leads into the history
      // check instead of straight to notFound()).
      const { data: activeWorkspace, error: activeWorkspaceError } =
        await adminClient
          .from("workspaces")
          .select("id, name, slug")
          .eq("slug", oldSlug)
          .maybeSingle();
      expect(activeWorkspaceError).toBeNull();
      expect(activeWorkspace).toBeNull();

      // Step 2: resolve the old slug against workspace_slug_history.
      const { data: slugHistoryRow, error: slugHistoryError } =
        await adminClient
          .from("workspace_slug_history")
          .select("workspace_id")
          .eq("old_slug", oldSlug)
          .maybeSingle();
      expect(slugHistoryError).toBeNull();
      expect(slugHistoryRow?.workspace_id).toBe(workspace.id);

      // Step 3: resolve that workspace id to its CURRENT slug — this is
      // the value the layout's `permanentRedirect(\`/w/${slug}\`)` call
      // is built from. Asserting it equals `newSlug` is what proves the
      // old URL redirects to the *new* URL specifically, not merely that
      // some redirect fires.
      const { data: currentWorkspace, error: currentWorkspaceError } =
        await adminClient
          .from("workspaces")
          .select("slug")
          .eq("id", slugHistoryRow!.workspace_id)
          .is("deleted_at", null)
          .maybeSingle();
      expect(currentWorkspaceError).toBeNull();
      expect(currentWorkspace?.slug).toBe(newSlug);
    });

    it("AS-242 (negative): a slug already in use by another LIVE workspace is rejected with a field-level error", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      currentTestUserId = await seedMember(workspaceA.id, "owner");
      await seedMember(workspaceB.id, "owner");

      const result = await changeWorkspaceSlug(workspaceA.id, workspaceB.slug);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/already in use/i);
      }

      const { data: row } = await adminClient
        .from("workspaces")
        .select("slug")
        .eq("id", workspaceA.id)
        .maybeSingle();
      expect(row?.slug).toBe(workspaceA.slug);
    });

    it("AS-242 (negative): a slug that used to belong to another workspace (now in history) is rejected", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      const workspaceAOwnerId = await seedMember(workspaceA.id, "owner");
      const workspaceBOwnerId = await seedMember(workspaceB.id, "owner");

      // Retire workspaceA's original slug by changing it once.
      const retiredSlug = workspaceA.slug;
      currentTestUserId = workspaceAOwnerId;
      const firstChange = await changeWorkspaceSlug(
        workspaceA.id,
        `f137-a-moved-${uniqueSuffix()}`,
      );
      expect(firstChange.ok).toBe(true);

      // Now workspaceB's owner tries to claim workspaceA's now-retired
      // slug for themselves.
      currentTestUserId = workspaceBOwnerId;
      const result = await changeWorkspaceSlug(workspaceB.id, retiredSlug);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/used before|reuse/i);
      }
    });

    it("AS-242 (negative): submitting an invalid slug shape is rejected before touching the database", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspace = await createWorkspace();
      currentTestUserId = await seedMember(workspace.id, "owner");

      const result = await changeWorkspaceSlug(
        workspace.id,
        "Not A Valid Slug!!",
      );

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("workspaces")
        .select("slug")
        .eq("id", workspace.id)
        .maybeSingle();
      expect(row?.slug).toBe(workspace.slug);
    });

    it("(failure case): a plain member is rejected server-side even called directly", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspace = await createWorkspace();
      currentTestUserId = await seedMember(workspace.id, "member");

      const result = await changeWorkspaceSlug(
        workspace.id,
        `f137-should-not-apply-${uniqueSuffix()}`,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/owner or admin/i);
      }
    });

    it("(failure case): an unauthenticated caller cannot change a workspace's slug", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspace = await createWorkspace();
      currentTestUserId = null;

      const result = await changeWorkspaceSlug(
        workspace.id,
        `f137-should-not-apply-${uniqueSuffix()}`,
      );

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to change a workspace's URL.",
      });
    });

    it("(side effect): changing one workspace's slug does not affect another workspace's row", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      currentTestUserId = await seedMember(workspaceA.id, "owner");
      await seedMember(workspaceB.id, "owner");
      const workspaceBSlug = workspaceB.slug;

      const result = await changeWorkspaceSlug(
        workspaceA.id,
        `f137-only-a-${uniqueSuffix()}`,
      );
      expect(result.ok).toBe(true);

      const { data: rowB } = await adminClient
        .from("workspaces")
        .select("slug")
        .eq("id", workspaceB.id)
        .maybeSingle();
      expect(rowB?.slug).toBe(workspaceBSlug);
    });

    it("submitting the workspace's own current slug unchanged succeeds as a no-op (not a false collision)", async () => {
      const { changeWorkspaceSlug } = await import(
        "@/lib/actions/workspaces"
      );
      const workspace = await createWorkspace();
      currentTestUserId = await seedMember(workspace.id, "owner");

      const result = await changeWorkspaceSlug(workspace.id, workspace.slug);

      expect(result).toEqual({ ok: true, data: { slug: workspace.slug } });
    });
  },
);
