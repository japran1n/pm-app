// Integration test for F020 (missions/20260903-portal, M4 — Hours and
// results): `project_metrics`, `metric_snapshots`, `project_improvements`,
// and the baseline freeze trigger. Covers AS-039, AS-040, AS-041.
//
// Driven through real signed-in sessions and PostgREST, matching this
// mission's established convention (tests/integration/
// f012-deliverables-scope-decisions-assumptions-rls.test.ts).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { deriveMetricMeasurementStatus } from "@/lib/queries/metrics";

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
const FROZEN_BASELINE_ERROR = "42501";

describe.skipIf(!haveCreds)(
  "project_metrics / metric_snapshots / project_improvements / baseline freeze",
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
          email: `f020-metrics-${label}-${suffix}@example.com`,
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
        .insert({ name: "F020 metrics test", slug: `f020-metrics-${suffix}` })
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
      const projectIds = [enabledProjectId, disabledProjectId];
      const { data: metricRows } = await admin
        .from("project_metrics")
        .select("id")
        .in("project_id", projectIds);
      const metricIds = (metricRows ?? []).map((r) => r.id as string);
      if (metricIds.length > 0) {
        await admin.from("metric_snapshots").delete().in("metric_id", metricIds);
      }
      await admin.from("project_metrics").delete().in("project_id", projectIds);
      await admin.from("project_improvements").delete().in("project_id", projectIds);
      await admin.from("project_members").delete().in("project_id", projectIds);
      await admin.from("projects").delete().in("id", projectIds);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // --- AS-039: baseline metrics -----------------------------------------

    describe("AS-039: a project can record baseline metrics with value, unit, target, and source", () => {
      let metricId: string;

      beforeAll(async () => {
        const { data, error } = await admin
          .from("project_metrics")
          .insert({
            project_id: enabledProjectId,
            name: "LCP",
            unit: "ms",
            source: "lighthouse",
            baseline_value: 4200,
            baseline_at: "2026-01-01",
            target_value: 2500,
            direction: "lower",
            position: 1,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`metric: ${error?.message}`);
        metricId = data.id;
      });

      it("a team member reads value, unit, target and source back", async () => {
        const { data, error } = await memberSession
          .from("project_metrics")
          .select("baseline_value, unit, target_value, source, direction")
          .eq("id", metricId)
          .single();
        expect(error).toBeNull();
        expect(data).toMatchObject({
          baseline_value: 4200,
          unit: "ms",
          target_value: 2500,
          source: "lighthouse",
          direction: "lower",
        });
      });

      it("a client on a portal-enabled project reads the same client_visible metric", async () => {
        const { data, error } = await clientSession
          .from("project_metrics")
          .select("id")
          .eq("id", metricId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("rejects an invalid source", async () => {
        const { error } = await admin.from("project_metrics").insert({
          project_id: enabledProjectId,
          name: "Bad source",
          source: "not-a-real-source",
          direction: "higher",
          position: 99,
        });
        expect(error).not.toBeNull();
      });
    });

    // --- AS-040: freeze -----------------------------------------------------

    describe("AS-040: once frozen, a project's baseline values are immutable; measurements become snapshots", () => {
      let freezeProjectId: string;
      let metricId: string;

      beforeAll(async () => {
        const { data: project, error: projectError } = await admin
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: "Freeze test project",
            visibility: "workspace",
            created_by: ownerId,
            portal_enabled: true,
          })
          .select("id")
          .single();
        if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
        freezeProjectId = project.id;

        const { data: metric, error: metricError } = await admin
          .from("project_metrics")
          .insert({
            project_id: freezeProjectId,
            name: "Sessions",
            source: "ga4",
            baseline_value: 100,
            baseline_at: "2026-01-01",
            direction: "higher",
            position: 1,
          })
          .select("id")
          .single();
        if (metricError || !metric) throw new Error(`metric: ${metricError?.message}`);
        metricId = metric.id;
      });

      afterAll(async () => {
        await admin.from("metric_snapshots").delete().eq("metric_id", metricId);
        await admin.from("project_metrics").delete().eq("id", metricId);
        await admin.from("projects").delete().eq("id", freezeProjectId);
      });

      it("before freezing, the baseline value can still be edited", async () => {
        const { error } = await admin
          .from("project_metrics")
          .update({ baseline_value: 110 })
          .eq("id", metricId);
        expect(error).toBeNull();

        // restore for the rest of this describe block
        const { error: restoreError } = await admin
          .from("project_metrics")
          .update({ baseline_value: 100 })
          .eq("id", metricId);
        expect(restoreError).toBeNull();
      });

      it("primary success test: after freezing, an update to baseline_value is rejected", async () => {
        const { error: freezeError } = await admin
          .from("projects")
          .update({ baseline_frozen_at: new Date().toISOString() })
          .eq("id", freezeProjectId);
        expect(freezeError).toBeNull();

        const { error: updateError } = await admin
          .from("project_metrics")
          .update({ baseline_value: 999 })
          .eq("id", metricId);
        expect(updateError).not.toBeNull();
        expect(updateError?.code).toBe(FROZEN_BASELINE_ERROR);

        const { data: unchanged } = await admin
          .from("project_metrics")
          .select("baseline_value")
          .eq("id", metricId)
          .single();
        expect(unchanged?.baseline_value).toBe(100);
      });

      it("a frozen baseline also rejects a change to baseline_at alone", async () => {
        const { error } = await admin
          .from("project_metrics")
          .update({ baseline_at: "2026-02-01" })
          .eq("id", metricId);
        expect(error).not.toBeNull();
        expect(error?.code).toBe(FROZEN_BASELINE_ERROR);
      });

      it("a frozen metric's OTHER fields (name, client_visible, position, target_value) remain editable — the trigger guards the two baseline fields by name, not the whole row", async () => {
        const { error } = await admin
          .from("project_metrics")
          .update({ name: "Sessions (renamed)", client_visible: false, target_value: 500 })
          .eq("id", metricId);
        expect(error).toBeNull();

        const { data } = await admin
          .from("project_metrics")
          .select("name, client_visible, target_value")
          .eq("id", metricId)
          .single();
        expect(data).toMatchObject({
          name: "Sessions (renamed)",
          client_visible: false,
          target_value: 500,
        });

        // restore client_visible for any later assertion in this block
        await admin.from("project_metrics").update({ client_visible: true }).eq("id", metricId);
      });

      it("primary success test: a snapshot insert succeeds after freezing", async () => {
        const { data, error } = await admin
          .from("metric_snapshots")
          .insert({
            metric_id: metricId,
            value: 150,
            measured_at: "2026-03-01",
            created_by: ownerId,
          })
          .select("id, value, measured_at")
          .single();
        expect(error).toBeNull();
        expect(data).toMatchObject({ value: 150, measured_at: "2026-03-01" });
      });
    });

    // --- AS-041: not yet measured -------------------------------------------

    describe("AS-041: a metric with no post-baseline snapshot reads as not yet measured, never as an improvement", () => {
      it("deriveMetricMeasurementStatus returns not_measured when there is no snapshot", () => {
        const status = deriveMetricMeasurementStatus(
          { baselineValue: 4200, direction: "lower" },
          null,
        );
        expect(status).toBe("not_measured");
      });

      it("deriveMetricMeasurementStatus returns not_measured when there is no baseline at all, even with a snapshot", () => {
        const status = deriveMetricMeasurementStatus(
          { baselineValue: null, direction: "lower" },
          { id: "x", metricId: "x", value: 10, measuredAt: "2026-01-01", note: null, createdBy: "x", createdAt: "2026-01-01" },
        );
        expect(status).toBe("not_measured");
      });

      it("direction matters: for a 'lower is better' metric, a smaller latest value is an improvement", () => {
        const status = deriveMetricMeasurementStatus(
          { baselineValue: 4200, direction: "lower" },
          { id: "x", metricId: "x", value: 2000, measuredAt: "2026-03-01", note: null, createdBy: "x", createdAt: "2026-03-01" },
        );
        expect(status).toBe("improved");
      });

      it("direction matters: for a 'lower is better' metric, a LARGER latest value is a regression, never an improvement", () => {
        const status = deriveMetricMeasurementStatus(
          { baselineValue: 4200, direction: "lower" },
          { id: "x", metricId: "x", value: 5000, measuredAt: "2026-03-01", note: null, createdBy: "x", createdAt: "2026-03-01" },
        );
        expect(status).toBe("regressed");
      });

      it("direction matters: for a 'higher is better' metric, a larger latest value is an improvement", () => {
        const status = deriveMetricMeasurementStatus(
          { baselineValue: 100, direction: "higher" },
          { id: "x", metricId: "x", value: 150, measuredAt: "2026-03-01", note: null, createdBy: "x", createdAt: "2026-03-01" },
        );
        expect(status).toBe("improved");
      });

      it("direction matters: for a 'higher is better' metric, a SMALLER latest value is a regression, never an improvement", () => {
        const status = deriveMetricMeasurementStatus(
          { baselineValue: 100, direction: "higher" },
          { id: "x", metricId: "x", value: 60, measuredAt: "2026-03-01", note: null, createdBy: "x", createdAt: "2026-03-01" },
        );
        expect(status).toBe("regressed");
      });
    });

    // --- Failure test: client_visible = false is absent from portal queries,
    //     including aggregates -------------------------------------------

    describe("failure test: a client_visible = false metric is absent from portal reads, including counts", () => {
      let hiddenMetricId: string;
      let visibleMetricId: string;

      beforeAll(async () => {
        const { data: hidden, error: hiddenError } = await admin
          .from("project_metrics")
          .insert({
            project_id: enabledProjectId,
            name: "Internal-only metric",
            source: "manual",
            direction: "higher",
            client_visible: false,
            position: 50,
          })
          .select("id")
          .single();
        if (hiddenError || !hidden) throw new Error(`hidden metric: ${hiddenError?.message}`);
        hiddenMetricId = hidden.id;

        const { data: visible, error: visibleError } = await admin
          .from("project_metrics")
          .insert({
            project_id: enabledProjectId,
            name: "Client-visible metric",
            source: "manual",
            direction: "higher",
            client_visible: true,
            position: 51,
          })
          .select("id")
          .single();
        if (visibleError || !visible) throw new Error(`visible metric: ${visibleError?.message}`);
        visibleMetricId = visible.id;
      });

      afterAll(async () => {
        await admin.from("project_metrics").delete().in("id", [hiddenMetricId, visibleMetricId]);
      });

      it("is absent from a direct id lookup by the client", async () => {
        const { data, error } = await clientSession
          .from("project_metrics")
          .select("id")
          .eq("id", hiddenMetricId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("is absent from the client's project-scoped list, while the visible sibling is present", async () => {
        const { data, error } = await clientSession
          .from("project_metrics")
          .select("id")
          .eq("project_id", enabledProjectId);
        expect(error).toBeNull();
        const ids = (data ?? []).map((row) => row.id as string);
        expect(ids).not.toContain(hiddenMetricId);
        expect(ids).toContain(visibleMetricId);
      });

      it("is absent from a client-side count aggregate", async () => {
        const { count, error } = await clientSession
          .from("project_metrics")
          .select("id", { count: "exact", head: true })
          .eq("project_id", enabledProjectId)
          .eq("id", hiddenMetricId);
        expect(error).toBeNull();
        expect(count).toBe(0);
      });

      it("a team member still sees the hidden metric — the flag hides from the client, not from the team", async () => {
        const { data, error } = await memberSession
          .from("project_metrics")
          .select("id")
          .eq("id", hiddenMetricId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });
    });

    // --- portal_enabled gate, project_improvements --------------------------

    describe("project_improvements: client_visible gate and portal_enabled gate", () => {
      let disabledImprovementId: string;

      beforeAll(async () => {
        const { data, error } = await admin
          .from("project_improvements")
          .insert({
            project_id: disabledProjectId,
            area: "Speed",
            explanation: "Reduced LCP from 4.2s to 2.1s.",
            position: 1,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`improvement: ${error?.message}`);
        disabledImprovementId = data.id;
      });

      afterAll(async () => {
        await admin.from("project_improvements").delete().eq("id", disabledImprovementId);
      });

      it("is invisible to a client on a portal-disabled project", async () => {
        const { data, error } = await clientSession
          .from("project_improvements")
          .select("id")
          .eq("id", disabledImprovementId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("a team member on the same project sees it regardless of portal_enabled", async () => {
        const { data, error } = await memberSession
          .from("project_improvements")
          .select("id")
          .eq("id", disabledImprovementId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("a client has no INSERT path", async () => {
        const { error } = await clientSession.from("project_improvements").insert({
          project_id: enabledProjectId,
          area: "Client-authored (should be rejected)",
          explanation: "x",
          position: 2,
        });
        expect(error).not.toBeNull();
        expect(error?.code).toBe(FROZEN_BASELINE_ERROR);
      });
    });

    // --- metric_snapshots visibility follows the parent metric --------------

    describe("metric_snapshots: visibility follows the parent metric's client_visible, not a flag of its own", () => {
      let hiddenMetricId: string;
      let snapshotId: string;

      beforeAll(async () => {
        const { data: metric, error: metricError } = await admin
          .from("project_metrics")
          .insert({
            project_id: enabledProjectId,
            name: "Hidden metric with a snapshot",
            source: "manual",
            direction: "higher",
            client_visible: false,
            position: 60,
          })
          .select("id")
          .single();
        if (metricError || !metric) throw new Error(`metric: ${metricError?.message}`);
        hiddenMetricId = metric.id;

        const { data: snapshot, error: snapshotError } = await admin
          .from("metric_snapshots")
          .insert({
            metric_id: hiddenMetricId,
            value: 42,
            measured_at: "2026-04-01",
            created_by: ownerId,
          })
          .select("id")
          .single();
        if (snapshotError || !snapshot) throw new Error(`snapshot: ${snapshotError?.message}`);
        snapshotId = snapshot.id;
      });

      afterAll(async () => {
        await admin.from("metric_snapshots").delete().eq("id", snapshotId);
        await admin.from("project_metrics").delete().eq("id", hiddenMetricId);
      });

      it("a client cannot see the snapshot of a hidden metric", async () => {
        const { data, error } = await clientSession
          .from("metric_snapshots")
          .select("id")
          .eq("id", snapshotId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("a team member can see it", async () => {
        const { data, error } = await memberSession
          .from("metric_snapshots")
          .select("id")
          .eq("id", snapshotId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("a client has no INSERT path onto any metric", async () => {
        const { error } = await clientSession.from("metric_snapshots").insert({
          metric_id: hiddenMetricId,
          value: 1,
          measured_at: "2026-04-02",
          created_by: clientId,
        });
        expect(error).not.toBeNull();
        expect(error?.code).toBe(FROZEN_BASELINE_ERROR);
      });
    });
  },
);
