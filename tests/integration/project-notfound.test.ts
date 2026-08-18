// Integration test for F031 (AS-039, AS-040), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/project-detail.test.ts and
// tests/integration/workspace-not-found-scope.test.ts.
//
// The project detail layout (app/(workspace)/w/[workspaceSlug]/projects/
// [projectId]/layout.tsx) is a Server Component that needs a live Next.js
// request/cookie context to render, so it isn't unit-rendered here.
// Instead this test exercises the exact data path the layout runs before
// calling `notFound()`: `getProjectById(workspace.id, projectId)`
// (lib/queries/projects.ts), where `workspace.id` is only ever resolved
// from an RLS-scoped lookup of the active workspace by slug.
//
// AS-039: an invalid/deleted-and-purged project id must resolve to
// `notFound()`, not an error page.
// AS-040: a project id that is real but belongs to a DIFFERENT workspace
// than the URL's workspaceSlug must ALSO resolve to `notFound()` — not
// partial data, and not a distinguishable error — mirroring F023's AS-144
// non-leakage principle one level down (project existence instead of
// workspace existence).
//
// This suite also verifies the security property called out in this
// feature's task brief: `getProjectById` uses the Supabase admin client,
// which bypasses RLS entirely (including the `deleted_at IS NULL` filter,
// deliberately, so archived projects still render per F029/AS-032). Since
// the admin client bypasses ALL RLS — not just that one filter — the query
// itself re-checks `.eq("workspace_id", workspaceId)`, and `workspaceId`
// is only ever supplied by the caller from an RLS-scoped workspace lookup
// (the outer /w/[workspaceSlug]/layout.tsx and this layout's own
// `workspaces` select, both scoped by `workspaces_select_active_members`).
// The last test proves this chain actually blocks a non-member: a
// non-member of workspace B, given workspace B's real slug and a real
// project id inside it, cannot reach a `getProjectById` call scoped to
// workspace B's id at all, because their own RLS-scoped workspace lookup
// for that slug returns no row first.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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

describe.skipIf(!haveAdminCreds)(
  "project not-found handling (F031: AS-039, AS-040)",
  () => {
    let adminClient: SupabaseClient;
    let outsiderClient: SupabaseClient;
    let ownerUserId: string;
    let outsiderUserId: string;
    let workspaceAId: string;
    let workspaceBId: string;
    let workspaceBSlug: string;
    let projectInAId: string;
    let projectInBId: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Owner of both workspaces (used to seed real projects).
      const { data: ownerAuth, error: ownerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f031-owner-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`Failed to create owner user: ${ownerAuthErr?.message}`);
      }
      ownerUserId = ownerAuth.user.id;

      // A separate user who is a member of NEITHER workspace — used to
      // prove non-member isolation for the security check.
      const outsiderEmail = `f031-outsider-${uniqueSuffix}@example.com`;
      const outsiderPassword = "Test-password-1!";
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }
      outsiderUserId = outsiderAuth.user.id;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F031 Workspace A", slug: `f031-ws-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      workspaceBSlug = `f031-ws-b-${uniqueSuffix}`;
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F031 Workspace B", slug: workspaceBSlug })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceAId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceBId, user_id: ownerUserId, role: "owner", status: "active" },
      ]);
      if (memberErr) throw new Error(`Failed to seed owner memberships: ${memberErr.message}`);
      // Note: outsiderUserId deliberately gets NO workspace_members rows.

      const { data: projA, error: projAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F031 Project A", created_by: ownerUserId })
        .select("id")
        .single();
      if (projAErr || !projA) throw new Error(`Failed to seed project A: ${projAErr?.message}`);
      projectInAId = projA.id;

      const { data: projB, error: projBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "F031 Project B", created_by: ownerUserId })
        .select("id")
        .single();
      if (projBErr || !projB) throw new Error(`Failed to seed project B: ${projBErr?.message}`);
      projectInBId = projB.id;

      outsiderClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await outsiderClient.auth.signInWithPassword({
        email: outsiderEmail,
        password: outsiderPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in outsider: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of [projectInAId, projectInBId]) {
        if (id) await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of [workspaceAId, workspaceBId]) {
        if (!id) continue;
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
      if (outsiderUserId) await adminClient.auth.admin.deleteUser(outsiderUserId);
    });

    it("AS-039: an invalid/nonexistent project id resolves to null (-> notFound()), not a thrown error", async () => {
      const { getProjectById } = await import("@/lib/queries/projects");

      const result = await getProjectById(
        workspaceAId,
        "00000000-0000-0000-0000-000000000000",
      );

      expect(result).toBeNull();
    });

    it("AS-040: a real project id belonging to a different workspace resolves to null, not partial data", async () => {
      const { getProjectById } = await import("@/lib/queries/projects");

      // projectInBId is real, but we're asking scoped to workspace A.
      const crossWorkspaceResult = await getProjectById(workspaceAId, projectInBId);
      expect(crossWorkspaceResult).toBeNull();

      // Sanity: the project really does exist (admin can see it), so the
      // null above is the workspace_id scoping doing its job, not the
      // project actually being missing.
      const { data: adminView } = await adminClient
        .from("projects")
        .select("id")
        .eq("id", projectInBId)
        .maybeSingle();
      expect(adminView?.id).toBe(projectInBId);
    });

    it("AS-040 (non-leakage): nonexistent id and wrong-workspace id are indistinguishable results", async () => {
      const { getProjectById } = await import("@/lib/queries/projects");

      const nonexistentResult = await getProjectById(
        workspaceAId,
        "00000000-0000-0000-0000-000000000000",
      );
      const wrongWorkspaceResult = await getProjectById(workspaceAId, projectInBId);

      // Both must be exactly `null` — the layout's `if (!project)
      // notFound()` branch fires identically in both cases, so nothing
      // about the response shape lets a caller tell "doesn't exist" apart
      // from "exists, wrong workspace".
      expect(nonexistentResult).toBeNull();
      expect(wrongWorkspaceResult).toBeNull();
      expect(wrongWorkspaceResult).toEqual(nonexistentResult);

      // The happy path still works, proving both nulls above are the
      // scoping doing its job, not a broken query.
      const correctResult = await getProjectById(workspaceAId, projectInAId);
      expect(correctResult).not.toBeNull();
      expect(correctResult?.id).toBe(projectInAId);
    });

    it("security: a non-member cannot reach getProjectById scoped to another workspace by guessing a valid project UUID", async () => {
      // This is the layout's own first step, run as the outsider (RLS
      // applies): resolve workspace B by its real slug. `getProjectById`
      // is only ever called by the layout with the `id` this query
      // returns, so if this returns no row, workspace B's projects are
      // unreachable end-to-end for the outsider regardless of what
      // project UUID they guess.
      const { data: workspaceLookup, error: workspaceLookupErr } = await outsiderClient
        .from("workspaces")
        .select("id, name")
        .eq("slug", workspaceBSlug)
        .maybeSingle();

      expect(workspaceLookupErr).toBeNull();
      expect(workspaceLookup).toBeNull();

      // Sanity: workspace B really exists and really has a real project in
      // it (admin view) — the outsider's null above is RLS/membership
      // scoping, not the workspace actually being absent.
      const { data: adminWorkspaceView } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("id", workspaceBId)
        .maybeSingle();
      expect(adminWorkspaceView?.id).toBe(workspaceBId);

      // Even in the hypothetical where the outsider somehow supplied
      // workspace B's real id directly (bypassing the slug lookup
      // entirely — e.g. a forged/guessed value), getProjectById's own
      // `.eq("workspace_id", workspaceId)` filter still returns the real
      // row scoped correctly; the point is the layout never gets there
      // for a non-member because the RLS-scoped slug lookup above already
      // fails first. This documents that the admin-client bypass in
      // getProjectById is not, by itself, the authorization boundary —
      // the caller-supplied workspaceId is, and it is only ever sourced
      // from an RLS-scoped query.
      const { getProjectById } = await import("@/lib/queries/projects");
      const directResult = await getProjectById(workspaceBId, projectInBId);
      expect(directResult).not.toBeNull();
      expect(directResult?.id).toBe(projectInBId);
    });
  },
);
