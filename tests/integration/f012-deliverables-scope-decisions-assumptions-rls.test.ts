// Integration test for F012 (missions/20260903-portal, M3 — Your list,
// scope, decisions): `client_deliverables`, `project_scope_items`,
// `project_decisions`, `project_assumptions`. Covers AS-028, AS-043,
// AS-044, AS-045, AS-046.
//
// Driven through real signed-in sessions and PostgREST, matching this
// suite's established convention (tests/integration/f007-approvals-rls.test.ts,
// tests/integration/portal-phases-rls.test.ts) — the point is exercising
// the policies themselves against a real database, not a mocked query
// builder. No test here mocks the thing it asserts about.

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

describe.skipIf(!haveCreds)(
  "client_deliverables / project_scope_items / project_decisions / project_assumptions",
  () => {
    let admin: SupabaseClient;
    let memberSession: SupabaseClient;
    let clientSession: SupabaseClient;

    let workspaceId: string;
    let enabledProjectId: string;
    let disabledProjectId: string;
    let ownerId: string;
    let memberId: string;
    let clientId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f012-records-${label}-${suffix}@example.com`,
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
      ownerId = owner.id;
      memberId = memberUser.id;
      clientId = clientUser.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F012 records test", slug: `f012-records-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      ]);

      const insertProject = async (name: string, portalEnabled: boolean) => {
        const { data, error } = await admin
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name,
            visibility: "workspace",
            created_by: ownerId,
            portal_enabled: portalEnabled,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
        return data.id as string;
      };

      enabledProjectId = await insertProject("Portal on", true);
      disabledProjectId = await insertProject("Portal off", false);

      await admin.from("project_members").insert([
        { project_id: enabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
        { project_id: enabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
        { project_id: disabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
        { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      ]);

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
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("client_deliverables").delete().in("project_id", [enabledProjectId, disabledProjectId]);
      await admin.from("project_scope_items").delete().in("project_id", [enabledProjectId, disabledProjectId]);
      await admin.from("project_decisions").delete().in("project_id", [enabledProjectId, disabledProjectId]);
      await admin.from("project_assumptions").delete().in("project_id", [enabledProjectId, disabledProjectId]);
      await admin.from("project_members").delete().in("project_id", [enabledProjectId, disabledProjectId]);
      await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // --- AS-028: client_deliverables --------------------------------------

    describe("AS-028: a project can hold a list of items the client owes", () => {
      let deliverableId: string;

      beforeAll(async () => {
        const { data, error } = await admin
          .from("client_deliverables")
          .insert({
            project_id: enabledProjectId,
            title: "Homepage hero copy",
            kind: "copy",
            owner_name: "Jane at Acme",
            due_at: "2026-01-01",
            blocking: true,
            state: "not_started",
            position: 1,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`deliverable: ${error?.message}`);
        deliverableId = data.id;
      });

      it("a client on a portal-enabled project reads it with its kind, owner name, due date, blocking flag and state", async () => {
        const { data, error } = await clientSession
          .from("client_deliverables")
          .select("id, kind, owner_name, due_at, blocking, state")
          .eq("id", deliverableId)
          .single();
        expect(error).toBeNull();
        expect(data).toMatchObject({
          kind: "copy",
          owner_name: "Jane at Acme",
          due_at: "2026-01-01",
          blocking: true,
          state: "not_started",
        });
      });

      it("a team member reads it too", async () => {
        const { data, error } = await memberSession
          .from("client_deliverables")
          .select("id")
          .eq("id", deliverableId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("a client has no INSERT path", async () => {
        const { error } = await clientSession.from("client_deliverables").insert({
          project_id: enabledProjectId,
          title: "Client-authored (should be rejected)",
          kind: "copy",
          owner_name: "Someone",
          position: 2,
        });
        expect(error).not.toBeNull();
        expect(error?.code).toBe(RLS_DENIED);
      });

      it("a client has no UPDATE path", async () => {
        const { data: updated, error } = await clientSession
          .from("client_deliverables")
          .update({ state: "delivered" })
          .eq("id", deliverableId)
          .select("id");
        expect(error).toBeNull();
        expect(updated).toEqual([]);
        const { data: unchanged } = await admin
          .from("client_deliverables")
          .select("state")
          .eq("id", deliverableId)
          .single();
        expect(unchanged?.state).toBe("not_started");
      });

      it("a client has no DELETE path", async () => {
        const { data: deleted, error } = await clientSession
          .from("client_deliverables")
          .delete()
          .eq("id", deliverableId)
          .select("id");
        expect(error).toBeNull();
        expect(deleted).toEqual([]);
        const { data: stillThere } = await admin
          .from("client_deliverables")
          .select("id")
          .eq("id", deliverableId);
        expect(stillThere).toHaveLength(1);
      });
    });

    // --- portal_enabled gate, all four tables -----------------------------

    describe("a portal-disabled project's rows are invisible to its client, absent from selects, counts, and every RPC", () => {
      let disabledDeliverableId: string;

      beforeAll(async () => {
        const { data: d, error: dErr } = await admin
          .from("client_deliverables")
          .insert({
            project_id: disabledProjectId,
            title: "Portal-off deliverable",
            kind: "copy",
            owner_name: "Someone",
            position: 1,
          })
          .select("id")
          .single();
        if (dErr || !d) throw new Error(`deliverable: ${dErr?.message}`);
        disabledDeliverableId = d.id;

        await admin.from("project_scope_items").insert({
          project_id: disabledProjectId,
          title: "Portal-off scope item",
          included: true,
          source: "proposal",
          position: 1,
        });

        await admin.from("project_decisions").insert({
          project_id: disabledProjectId,
          title: "Portal-off decision",
          decision_type: "technical",
          created_by: ownerId,
          client_visible: true,
        });

        await admin.from("project_assumptions").insert({
          project_id: disabledProjectId,
          text: "Portal-off assumption",
          client_visible: true,
        });
      });

      it("client_deliverables: client sees none via select", async () => {
        const { data, error } = await clientSession
          .from("client_deliverables")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("client_deliverables: client's count is zero, not merely its selected rows", async () => {
        const { count, error } = await clientSession
          .from("client_deliverables")
          .select("id", { count: "exact", head: true })
          .eq("project_id", disabledProjectId);
        expect(error).toBeNull();
        expect(count).toBe(0);
      });

      it("client_deliverables: is_project_portal_enabled RPC agrees the project is disabled (the predicate every RPC and policy in this migration routes through)", async () => {
        const { data, error } = await clientSession.rpc("is_project_portal_enabled", {
          target_project_id: disabledProjectId,
        });
        expect(error).toBeNull();
        expect(data).toBe(false);
      });

      it("project_scope_items: client sees none", async () => {
        const { data, error } = await clientSession
          .from("project_scope_items")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("project_decisions: client sees none, even though client_visible = true", async () => {
        const { data, error } = await clientSession
          .from("project_decisions")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("project_assumptions: client sees none, even though client_visible = true", async () => {
        const { data, error } = await clientSession
          .from("project_assumptions")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("regression: a team member still sees all four", async () => {
        const { data: deliverables } = await memberSession
          .from("client_deliverables")
          .select("id")
          .eq("id", disabledDeliverableId);
        expect(deliverables).toHaveLength(1);

        const { data: scope } = await memberSession
          .from("project_scope_items")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(scope).toHaveLength(1);

        const { data: decisions } = await memberSession
          .from("project_decisions")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(decisions).toHaveLength(1);

        const { data: assumptions } = await memberSession
          .from("project_assumptions")
          .select("id")
          .eq("project_id", disabledProjectId);
        expect(assumptions).toHaveLength(1);
      });
    });

    // --- AS-043: project_scope_items ---------------------------------------

    describe("AS-043: a project can record scope items marked as included or excluded, each with its source", () => {
      it("a client reads both an included and an excluded item, each with its source", async () => {
        await admin.from("project_scope_items").insert([
          {
            project_id: enabledProjectId,
            title: "Homepage redesign",
            included: true,
            source: "proposal",
            position: 1,
          },
          {
            project_id: enabledProjectId,
            title: "Mobile app",
            included: false,
            source: "proposal",
            position: 2,
          },
        ]);

        const { data, error } = await clientSession
          .from("project_scope_items")
          .select("title, included, source")
          .eq("project_id", enabledProjectId)
          .order("position");
        expect(error).toBeNull();
        expect(data).toEqual([
          { title: "Homepage redesign", included: true, source: "proposal" },
          { title: "Mobile app", included: false, source: "proposal" },
        ]);
      });

      it("a client has no write path to project_scope_items", async () => {
        const { error: insertError } = await clientSession.from("project_scope_items").insert({
          project_id: enabledProjectId,
          title: "Client-authored (should be rejected)",
          included: true,
          source: "proposal",
          position: 3,
        });
        expect(insertError).not.toBeNull();
        expect(insertError?.code).toBe(RLS_DENIED);
      });
    });

    // --- AS-044/AS-045: project_decisions -----------------------------------

    describe("AS-044/AS-045: decisions carry a rationale, type, date and client-visibility flag; a non-visible one is absent from every portal response", () => {
      let visibleDecisionId: string;
      let hiddenDecisionId: string;

      beforeAll(async () => {
        const { data: visible, error: visErr } = await admin
          .from("project_decisions")
          .insert({
            project_id: enabledProjectId,
            title: "Use brand blue for CTAs",
            rationale: "Matches the approved moodboard",
            decision_type: "brand",
            decided_on: "2026-02-01",
            client_visible: true,
            created_by: ownerId,
          })
          .select("id")
          .single();
        if (visErr || !visible) throw new Error(`decision: ${visErr?.message}`);
        visibleDecisionId = visible.id;

        const { data: hidden, error: hidErr } = await admin
          .from("project_decisions")
          .insert({
            project_id: enabledProjectId,
            title: "Internal: switch hosting provider mid-project",
            rationale: "Cost — must never reach the client",
            decision_type: "technical",
            decided_on: "2026-02-02",
            client_visible: false,
            created_by: ownerId,
          })
          .select("id")
          .single();
        if (hidErr || !hidden) throw new Error(`decision: ${hidErr?.message}`);
        hiddenDecisionId = hidden.id;
      });

      it("a client reads the client-visible decision with its rationale, type, and date", async () => {
        const { data, error } = await clientSession
          .from("project_decisions")
          .select("title, rationale, decision_type, decided_on, client_visible")
          .eq("id", visibleDecisionId)
          .single();
        expect(error).toBeNull();
        expect(data).toMatchObject({
          title: "Use brand blue for CTAs",
          rationale: "Matches the approved moodboard",
          decision_type: "brand",
          decided_on: "2026-02-01",
          client_visible: true,
        });
      });

      it("AS-045: the non-visible decision is absent via a direct id lookup, title included", async () => {
        const { data, error } = await clientSession
          .from("project_decisions")
          .select("id, title")
          .eq("id", hiddenDecisionId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("AS-045: the non-visible decision is absent from a project-scoped list and from the count", async () => {
        const { data, error } = await clientSession
          .from("project_decisions")
          .select("id")
          .eq("project_id", enabledProjectId);
        expect(error).toBeNull();
        expect(data?.map((r) => r.id)).not.toContain(hiddenDecisionId);

        const { count, error: countError } = await clientSession
          .from("project_decisions")
          .select("id", { count: "exact", head: true })
          .eq("project_id", enabledProjectId)
          .eq("client_visible", false);
        expect(countError).toBeNull();
        expect(count).toBe(0);
      });

      it("regression: a team member sees the non-visible decision", async () => {
        const { data, error } = await memberSession
          .from("project_decisions")
          .select("id")
          .eq("id", hiddenDecisionId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("a client has no write path to project_decisions", async () => {
        const { error } = await clientSession.from("project_decisions").insert({
          project_id: enabledProjectId,
          title: "Client-authored (should be rejected)",
          decision_type: "brand",
          created_by: clientId,
        });
        expect(error).not.toBeNull();
        expect(error?.code).toBe(RLS_DENIED);
      });
    });

    // --- AS-046: project_assumptions ----------------------------------------

    describe("AS-046: a project can record assumptions with a confirmation state", () => {
      let visibleAssumptionId: string;
      let hiddenAssumptionId: string;

      beforeAll(async () => {
        const { data: visible, error: visErr } = await admin
          .from("project_assumptions")
          .insert({
            project_id: enabledProjectId,
            text: "The client will supply final logo files by kickoff",
            state: "assumed",
            client_visible: true,
          })
          .select("id")
          .single();
        if (visErr || !visible) throw new Error(`assumption: ${visErr?.message}`);
        visibleAssumptionId = visible.id;

        const { data: hidden, error: hidErr } = await admin
          .from("project_assumptions")
          .insert({
            project_id: enabledProjectId,
            text: "Internal: assuming the client's budget can flex 20%",
            state: "assumed",
            client_visible: false,
          })
          .select("id")
          .single();
        if (hidErr || !hidden) throw new Error(`assumption: ${hidErr?.message}`);
        hiddenAssumptionId = hidden.id;
      });

      it("a client reads the client-visible assumption with its confirmation state", async () => {
        const { data, error } = await clientSession
          .from("project_assumptions")
          .select("text, state")
          .eq("id", visibleAssumptionId)
          .single();
        expect(error).toBeNull();
        expect(data).toEqual({
          text: "The client will supply final logo files by kickoff",
          state: "assumed",
        });
      });

      it("the non-visible assumption is absent via a direct id lookup and from a project-scoped list", async () => {
        const { data: byId, error: idError } = await clientSession
          .from("project_assumptions")
          .select("id")
          .eq("id", hiddenAssumptionId);
        expect(idError).toBeNull();
        expect(byId).toEqual([]);

        const { data: list, error: listError } = await clientSession
          .from("project_assumptions")
          .select("id")
          .eq("project_id", enabledProjectId);
        expect(listError).toBeNull();
        expect(list?.map((r) => r.id)).not.toContain(hiddenAssumptionId);
      });

      it("regression: a team member sees the non-visible assumption", async () => {
        const { data, error } = await memberSession
          .from("project_assumptions")
          .select("id")
          .eq("id", hiddenAssumptionId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("a client has no UPDATE path to project_assumptions (the 'Not correct' flag is set only through F015's RPC)", async () => {
        const { data: updated, error } = await clientSession
          .from("project_assumptions")
          .update({ flagged_by_client_at: new Date().toISOString(), flagged_note: "This is wrong" })
          .eq("id", visibleAssumptionId)
          .select("id");
        expect(error).toBeNull();
        expect(updated).toEqual([]);
        const { data: unchanged } = await admin
          .from("project_assumptions")
          .select("flagged_by_client_at")
          .eq("id", visibleAssumptionId)
          .single();
        expect(unchanged?.flagged_by_client_at).toBeNull();
      });
    });
  },
);
