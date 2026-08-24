// Integration test for F226 swimlane-collapse-persist (AS-422, AS-424), run
// against the real linked Supabase project — mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown pattern
// established by tests/integration/f224-board-swimlane-grouping.test.ts and
// f225-swimlane-drag-reassign.test.ts, and the "mock @/lib/supabase/server's
// createClient to resolve to a REAL signed-in session client" pattern from
// f322-single-task-project-visibility.test.ts (needed here because, unlike
// f322's `auth.getUser()`-only mock, board-prefs.ts's own `.from(...)`
// table calls must go through a REAL RLS-scoped session, not a stub).
//
// Exercises the REAL Server Actions this feature adds
// (lib/actions/board-prefs.ts's getBoardSwimlanePrefs/
// upsertBoardSwimlanePrefs) against the real board_swimlane_prefs table and
// its RLS policies — never a hand-built fixture.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F226: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Swapped per-test to whichever signed-in client should back the next
// getBoardSwimlanePrefs/upsertBoardSwimlanePrefs call — the real
// request-scoped server client these actions read via `createClient()`.
let currentSessionClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F226 swimlane-collapse-persist (AS-422, AS-424)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;

    let userAEmail: string;
    let userBEmail: string;
    const password = "Test-password-1!";
    let userAId: string;
    let userBId: string;

    async function signInAs(email: string, pwd: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password: pwd });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      return client;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F226 Workspace", slug: `f226-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      userAEmail = `f226-a-${uniqueSuffix}@example.com`;
      userBEmail = `f226-b-${uniqueSuffix}@example.com`;

      const { data: userAData, error: userAErr } = await adminClient.auth.admin.createUser({
        email: userAEmail,
        password,
        email_confirm: true,
      });
      if (userAErr || !userAData.user) {
        throw new Error(`Failed to create user A: ${userAErr?.message}`);
      }
      userAId = userAData.user.id;
      createdUserIds.push(userAId);

      const { data: userBData, error: userBErr } = await adminClient.auth.admin.createUser({
        email: userBEmail,
        password,
        email_confirm: true,
      });
      if (userBErr || !userBData.user) {
        throw new Error(`Failed to create user B: ${userBErr?.message}`);
      }
      userBId = userBData.user.id;
      createdUserIds.push(userBId);

      const { error: memberErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: userAId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: userBId, role: "member", status: "active" },
      ]);
      if (memberErr) throw new Error(`Failed to seed members: ${memberErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F226 Project ${uniqueSuffix}`,
          created_by: userAId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("board_swimlane_prefs").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("test_AS_422_collapsing_a_lane_persists_across_a_real_reload_of_the_same_mode", async () => {
      const { getBoardSwimlanePrefs, upsertBoardSwimlanePrefs } = await import(
        "@/lib/actions/board-prefs"
      );

      currentSessionClient = await signInAs(userAEmail, password);

      // Default (no row yet): groupBy=none, no collapsed lanes.
      const before = await getBoardSwimlanePrefs(projectId);
      expect(before.ok).toBe(true);
      if (before.ok) {
        expect(before.data).toEqual({ groupBy: "none", collapsedLanes: {} });
      }

      // Collapse two lanes under "assignee" mode via the REAL action.
      const write = await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "assignee", keys: [userAId, "__none__"] },
      });
      expect(write.ok).toBe(true);

      // "Reload" — a fresh read through the same real action, proving the
      // REAL persistence round trip rather than component state.
      const after = await getBoardSwimlanePrefs(projectId);
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.data.collapsedLanes.assignee?.slice().sort()).toEqual(
          [userAId, "__none__"].sort(),
        );
      }
    });

    it("test_AS_424_chosen_grouping_persists_per_user_per_project_through_the_real_action", async () => {
      const { getBoardSwimlanePrefs, upsertBoardSwimlanePrefs } = await import(
        "@/lib/actions/board-prefs"
      );

      currentSessionClient = await signInAs(userAEmail, password);

      const write = await upsertBoardSwimlanePrefs({ projectId, groupBy: "priority" });
      expect(write.ok).toBe(true);

      const after = await getBoardSwimlanePrefs(projectId);
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.data.groupBy).toBe("priority");
      }
    });

    it("test_AS_422_AS_424_one_users_collapse_and_grouping_never_affects_another_users_prefs_for_the_same_project", async () => {
      const { getBoardSwimlanePrefs, upsertBoardSwimlanePrefs } = await import(
        "@/lib/actions/board-prefs"
      );

      // User A sets a distinctive grouping + collapse.
      currentSessionClient = await signInAs(userAEmail, password);
      await upsertBoardSwimlanePrefs({ projectId, groupBy: "tag" });
      await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "tag", keys: ["only-user-a-collapsed-this"] },
      });

      // User B, same project, has never written a preference — must see
      // their OWN defaults, not user A's row (own-row RLS, AS-422/AS-424's
      // "per user" half).
      currentSessionClient = await signInAs(userBEmail, password);
      const userBPrefs = await getBoardSwimlanePrefs(projectId);
      expect(userBPrefs.ok).toBe(true);
      if (userBPrefs.ok) {
        expect(userBPrefs.data).toEqual({ groupBy: "none", collapsedLanes: {} });
      }

      // User B writes their own, different preference.
      await upsertBoardSwimlanePrefs({ projectId, groupBy: "assignee" });
      const userBAfter = await getBoardSwimlanePrefs(projectId);
      expect(userBAfter.ok).toBe(true);
      if (userBAfter.ok) {
        expect(userBAfter.data.groupBy).toBe("assignee");
      }

      // User A's own row is completely unaffected by user B's write.
      currentSessionClient = await signInAs(userAEmail, password);
      const userAAfter = await getBoardSwimlanePrefs(projectId);
      expect(userAAfter.ok).toBe(true);
      if (userAAfter.ok) {
        expect(userAAfter.data.groupBy).toBe("tag");
        expect(userAAfter.data.collapsedLanes.tag).toEqual([
          "only-user-a-collapsed-this",
        ]);
      }
    });

    it("test_AS_422_switching_grouping_mode_does_not_carry_a_stale_collapse_across_modes", async () => {
      const { getBoardSwimlanePrefs, upsertBoardSwimlanePrefs } = await import(
        "@/lib/actions/board-prefs"
      );

      currentSessionClient = await signInAs(userAEmail, password);

      // Collapse a lane under "priority" mode.
      await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "priority", keys: ["urgent"] },
      });
      // Then a DIFFERENT lane, same key string, under "tag" mode.
      await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "tag", keys: ["urgent"] },
      });

      const prefs = await getBoardSwimlanePrefs(projectId);
      expect(prefs.ok).toBe(true);
      if (prefs.ok) {
        // Both modes independently keep their own "urgent" collapse — one
        // mode's write never overwrote or merged into the other's set.
        expect(prefs.data.collapsedLanes.priority).toEqual(["urgent"]);
        expect(prefs.data.collapsedLanes.tag).toEqual(["urgent"]);
      }

      // Now expand the "priority" lane (write an empty set for that mode
      // only) — "tag"'s own collapse must survive untouched.
      await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "priority", keys: [] },
      });
      const after = await getBoardSwimlanePrefs(projectId);
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.data.collapsedLanes.priority).toEqual([]);
        expect(after.data.collapsedLanes.tag).toEqual(["urgent"]);
      }
    });

    it("test_AS_422_a_lane_key_that_no_longer_exists_is_silently_dropped_on_the_next_write_for_that_mode_not_corrupted", async () => {
      const { getBoardSwimlanePrefs, upsertBoardSwimlanePrefs } = await import(
        "@/lib/actions/board-prefs"
      );

      currentSessionClient = await signInAs(userAEmail, password);

      // Simulate: two assignee lanes were collapsed, one of which
      // (userBId) later stops existing as a real lane (e.g. removed from
      // the project) — the board only ever re-sends keys for lanes that
      // currently render, so the next write for this mode naturally
      // prunes the stale key rather than needing a special-case migration
      // or crashing on lookup.
      await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "assignee", keys: [userAId, userBId] },
      });
      let prefs = await getBoardSwimlanePrefs(projectId);
      expect(prefs.ok).toBe(true);
      if (prefs.ok) {
        expect(prefs.data.collapsedLanes.assignee?.sort()).toEqual(
          [userAId, userBId].sort(),
        );
      }

      // Board re-renders with only userAId's lane still real; caller
      // sends the full current set (per board-prefs.ts's own doc comment
      // on why the write replaces, not merges).
      await upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: "assignee", keys: [userAId] },
      });
      prefs = await getBoardSwimlanePrefs(projectId);
      expect(prefs.ok).toBe(true);
      if (prefs.ok) {
        expect(prefs.data.collapsedLanes.assignee).toEqual([userAId]);
      }
    });

    it("test_AS_422_AS_424_deleting_the_parent_project_cascades_the_preference_row_away", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F226 Cascade Project ${uniqueSuffix}`,
          created_by: userAId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      const cascadeProjectId = proj.id as string;

      const { error: insertPrefErr } = await adminClient.from("board_swimlane_prefs").insert({
        user_id: userAId,
        project_id: cascadeProjectId,
        group_by: "tag",
        collapsed_lanes: { tag: ["x"] },
      });
      expect(insertPrefErr).toBeNull();

      // Parent hard-delete must succeed (ON DELETE CASCADE, not blocked
      // by an FK violation) and the preference row must be gone with it.
      const { error: deleteErr } = await adminClient
        .from("projects")
        .delete()
        .eq("id", cascadeProjectId);
      expect(deleteErr).toBeNull();

      const { data: remaining } = await adminClient
        .from("board_swimlane_prefs")
        .select("user_id")
        .eq("project_id", cascadeProjectId);
      expect(remaining ?? []).toHaveLength(0);
    });
  },
);
