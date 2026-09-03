// Integration test for F014 (missions/20260903-portal, M3 — Your list):
// `mark_deliverable_delivered_atomic` (20260928010000_f014_mark_deliverable_
// delivered_atomic.sql) — AS-030, AS-031's counterpart on the write side.
//
// Driven through real signed-in sessions and `.rpc()`, matching this
// mission's established convention (tests/integration/
// f013-deliverables-review-and-sweep.test.ts) — no test here mocks the
// function it is asserting about.

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

describe.skipIf(!haveCreds)(
  "mark_deliverable_delivered_atomic (F014: AS-030, AS-031)",
  () => {
    let admin: SupabaseClient;
    let clientSession: SupabaseClient;
    let outsiderSession: SupabaseClient;

    let workspaceId: string;
    let projectId: string;
    let portalDisabledProjectId: string;
    let ownerId: string;
    let clientId: string;

    const createdUserIds: string[] = [];
    const createdDeliverableIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f014-deliverables-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const clientUser = await makeUser("client");
      const outsiderUser = await makeUser("outsider");
      ownerId = owner.id;
      clientId = clientUser.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F014 deliverables test", slug: `f014-deliverables-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      // `outsiderId` is intentionally NOT added as a workspace member at
      // all — proves the RPC rejects a caller with no relationship to the
      // workspace, not just a client of a different project.
      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      ]);

      const { data: project, error: projectError } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F014 project",
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

      const { data: disabledProject, error: disabledProjectError } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F014 portal-disabled project",
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: false,
        })
        .select("id")
        .single();
      if (disabledProjectError || !disabledProject) {
        throw new Error(`disabled project: ${disabledProjectError?.message}`);
      }
      portalDisabledProjectId = disabledProject.id;

      await admin.from("project_members").insert([
        { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
        {
          project_id: portalDisabledProjectId,
          user_id: clientId,
          project_role: "member",
          added_by: ownerId,
        },
      ]);

      const signIn = async (email: string) => {
        const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
        if (error) throw new Error(`sign in ${email}: ${error.message}`);
        return session;
      };
      clientSession = await signIn(clientUser.email);
      outsiderSession = await signIn(outsiderUser.email);
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("client_deliverables").delete().in("id", createdDeliverableIds);
      await admin.from("project_members").delete().in("project_id", [projectId, portalDisabledProjectId]);
      await admin.from("projects").delete().in("id", [projectId, portalDisabledProjectId]);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    async function makeDeliverable(opts: {
      state?: string;
      projectId?: string;
    }) {
      const { data, error } = await admin
        .from("client_deliverables")
        .insert({
          project_id: opts.projectId ?? projectId,
          title: `F014 deliverable ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: "copy",
          owner_name: "Client contact",
          state: opts.state ?? "not_started",
          blocking: true,
        })
        .select("id, state")
        .single();
      if (error || !data) throw new Error(`deliverable: ${error?.message}`);
      createdDeliverableIds.push(data.id);
      return data;
    }

    // --- AS-030: a client's upload sets state to delivered, never accepted --

    it("test_AS_030_a_client_marking_delivered_sets_state_to_delivered_not_started_to_delivered", async () => {
      const deliverable = await makeDeliverable({ state: "not_started" });

      const { data, error } = await clientSession.rpc("mark_deliverable_delivered_atomic", {
        p_deliverable_id: deliverable.id,
      });
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      expect(row.state).toBe("delivered");

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state, delivered_at, accepted_at")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("delivered");
      expect(row2!.delivered_at).not.toBeNull();
      expect(row2!.accepted_at).toBeNull();
    });

    it("test_AS_030_re_delivering_a_returned_item_clears_its_stale_review_note", async () => {
      const deliverable = await makeDeliverable({ state: "in_progress" });
      await admin
        .from("client_deliverables")
        .update({ review_note: "Wrong resolution, please resend." })
        .eq("id", deliverable.id);

      const { error } = await clientSession.rpc("mark_deliverable_delivered_atomic", {
        p_deliverable_id: deliverable.id,
      });
      expect(error).toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state, review_note")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("delivered");
      expect(row2!.review_note).toBeNull();
    });

    it("test_AS_030_negative_this_rpc_has_no_argument_that_can_ever_reach_accepted", async () => {
      // The actual proof this RPC can never set 'accepted': its own SQL
      // signature (mark_deliverable_delivered_atomic(p_deliverable_id
      // uuid)) has no decision/state parameter at all — calling it with
      // one is simply a function-not-found error, not a bypass.
      const deliverable = await makeDeliverable({ state: "not_started" });

      const { error } = await clientSession.rpc("mark_deliverable_delivered_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "accepted",
      } as never);
      expect(error).not.toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("not_started");
    });

    it("test_AS_030_negative_a_client_cannot_reach_accepted_through_the_teams_own_rpc_either", async () => {
      // Belt-and-braces: the OTHER rpc that can set 'accepted'
      // (accept_deliverable_atomic, F013) is gated on
      // is_project_workspace_writer, which explicitly excludes 'client'
      // (20260902010000). Proves "no path to accepted, including calling
      // the action directly" holds across BOTH deliverable-mutating RPCs,
      // not just this feature's own new one.
      const deliverable = await makeDeliverable({ state: "delivered" });

      const { error } = await clientSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "accepted",
        p_note: null,
      });
      expect(error).not.toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("delivered");
    });

    it("test_AS_030_negative_an_already_accepted_deliverable_cannot_be_re_delivered", async () => {
      const deliverable = await makeDeliverable({ state: "accepted" });

      const { error } = await clientSession.rpc("mark_deliverable_delivered_atomic", {
        p_deliverable_id: deliverable.id,
      });
      expect(error).not.toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("accepted");
    });

    it("test_AS_030_negative_a_caller_with_no_relationship_to_the_workspace_gets_a_not_found_error", async () => {
      const deliverable = await makeDeliverable({ state: "not_started" });

      const { error } = await outsiderSession.rpc("mark_deliverable_delivered_atomic", {
        p_deliverable_id: deliverable.id,
      });
      expect(error).not.toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("not_started");
    });

    it("test_AS_030_negative_a_portal_disabled_projects_deliverable_is_invisible_to_this_rpc_too", async () => {
      const deliverable = await makeDeliverable({
        state: "not_started",
        projectId: portalDisabledProjectId,
      });

      const { error } = await clientSession.rpc("mark_deliverable_delivered_atomic", {
        p_deliverable_id: deliverable.id,
      });
      expect(error).not.toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("not_started");
    });
  },
);
