// F025 (missions/20260903-portal, M5 — the leak sweep): AS-054.
//
// "For every table added by this mission, a row that is not
// client-visible is absent from direct selects, from aggregates and
// counts, and from every RPC response."
//
// The table list is NOT hard-coded. It is derived live from the linked
// project's own catalog (`information_schema.columns`, restricted to
// `public` tables carrying a `client_visible boolean` column — the exact
// shape design constraint 5 requires every new client-visible table to
// copy from `tasks_select_client`). `TABLE_FIXTURES` below is then
// asserted to have exactly one entry per catalog-derived table, in both
// directions: a table added later with a `client_visible` column but no
// fixture entry fails this suite immediately (rather than silently
// passing with zero coverage of the new table), and a stale fixture
// entry for a table that no longer exists also fails.
//
// For each derived table this suite runs the three checks the spec asks
// for, as a real signed-in client session against the live project:
//   1. direct select — the hidden row's own marker string is absent
//   2. aggregate/count — Prefer: count=exact reports only the visible row
//   3. RPC — the same app query function the portal's own pages call
//      (lib/queries/project-records.ts, lib/queries/metrics.ts,
//      lib/queries/project-site.ts, lib/queries/portal.ts) never returns
//      the hidden row's marker either
//
// F025e re-enabled the `docs` RPC leg: F023 added `getClientVisibleDocs`
// (lib/queries/docs.ts) as the portal's own client-facing list-docs
// query, so the `rpc: null` this fixture used to carry is gone. The
// `NULL_RPC_ALLOWLIST` check further below fails this suite if a future
// fixture goes back to `rpc: null` without an entry (and reason) in that
// allowlist — the mechanism the comment above this once lacked: the old
// staleness check only proved a fixture *exists* per catalog table, not
// that its `rpc` leg still covers something.
//
// Failure test (this feature's Definition of Done, non-optional): the
// `project_phases` hidden fixture is flipped to `client_visible = true`
// mid-suite, the same triple is re-run and asserted to now REPORT THE
// LEAK (fail), then reverted. Proves the sweep can fail, not just pass.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

vi.setConfig({ testTimeout: 60000 });

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
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const haveRestCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
const haveMgmtCreds = Boolean(PROJECT_REF && ACCESS_TOKEN);
const haveCreds = haveRestCreds && haveMgmtCreds;

if (process.env.CI && !haveCreds) {
  throw new Error(
    "F025: missing Supabase credentials (REST + Management API) required to run this suite in CI.",
  );
}

async function mgmtSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`F025 mgmt SQL failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body as T[];
}

const PASSWORD = "Test-password-1!";

let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

type FixtureRow = { id: string; marker: string };

type TableFixture = {
  /** Inserts one client_visible row and one non-client_visible row,
   * both carrying a unique marker string in their primary text column,
   * scoped to the given project. Returns both rows. */
  insert: (
    admin: SupabaseClient,
    projectId: string,
    ctx: { workspaceId: string; userId: string },
  ) => Promise<{ visible: FixtureRow; hidden: FixtureRow }>;
  /** Column selected back over REST to find the marker. */
  markerColumn: string;
  /** Query-string filter identifying this project's rows over REST.
   * Defaults to `project_id=eq.<projectId>` when omitted -- only
   * `page_links` (keyed on `task_id`, no `project_id` column) needs to
   * override this. */
  restFilter?: (projectId: string) => string;
  /** The app query function this table's own portal page calls, or null
   * if none exists yet (see file header). */
  rpc: null | ((projectId: string) => Promise<unknown>);
  /** Flips the hidden row's client_visible flag — used only by the
   * failure test, on project_phases. */
  setClientVisible?: (
    admin: SupabaseClient,
    id: string,
    value: boolean,
  ) => Promise<void>;
  /** Extra teardown beyond deleting the two fixture rows themselves --
   * only `page_links` needs this, to remove the task it created to hang
   * the links off of (otherwise that task leaks into the `tasks`
   * fixture's own count check later in the same suite run). */
  cleanup?: (admin: SupabaseClient) => Promise<void>;
};

describe.skipIf(!haveCreds)("F025: per-table client-visible leak sweep (AS-054)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;
  let clientAccessToken: string;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f025-sweep-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F025 sweep", slug: `f025-sweep-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F025 sweep project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert({
      project_id: projectId,
      user_id: clientId,
      project_role: "member",
      added_by: ownerId,
    });

    const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await session.auth.signInWithPassword({
      email: clientUser.email,
      password: PASSWORD,
    });
    if (signInError) throw new Error(`sign in client: ${signInError.message}`);
    clientSession = session;
    const { data: sessData } = await session.auth.getSession();
    clientAccessToken = sessData.session!.access_token;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  function marker(table: string, visibility: "visible" | "hidden") {
    return `F025-${table}-${visibility}-${Math.random().toString(36).slice(2, 10)}`;
  }

  let getProjectPhases: typeof import("@/lib/queries/portal").getProjectPhases;
  let getProjectDecisions: typeof import("@/lib/queries/project-records").getProjectDecisions;
  let getProjectAssumptions: typeof import("@/lib/queries/project-records").getProjectAssumptions;
  let getProjectMetricsWithLatestSnapshot: typeof import("@/lib/queries/metrics").getProjectMetricsWithLatestSnapshot;
  let getProjectImprovements: typeof import("@/lib/queries/metrics").getProjectImprovements;
  let getClientVisiblePortalLinks: typeof import("@/lib/queries/project-site").getClientVisiblePortalLinks;
  let getClientVisiblePortalAccounts: typeof import("@/lib/queries/project-site").getClientVisiblePortalAccounts;
  let getClientVisibleDocs: typeof import("@/lib/queries/docs").getClientVisibleDocs;
  let getClientVisiblePageLinksByTaskIds: typeof import(
    "@/lib/queries/page-links"
  ).getClientVisiblePageLinksByTaskIds;
  let TABLE_FIXTURES: Record<string, TableFixture>;
  // page_links is keyed on task_id, not project_id -- the fixture's own
  // insert() stashes the task id it created here so restFilter/rpc can
  // find it.
  let pageLinksTaskId = "";

  beforeAll(async () => {
    ({ getProjectPhases } = await import("@/lib/queries/portal"));
    ({ getProjectDecisions, getProjectAssumptions } = await import(
      "@/lib/queries/project-records"
    ));
    ({ getProjectMetricsWithLatestSnapshot, getProjectImprovements } = await import(
      "@/lib/queries/metrics"
    ));
    ({ getClientVisiblePortalLinks, getClientVisiblePortalAccounts } = await import(
      "@/lib/queries/project-site"
    ));
    ({ getClientVisibleDocs } = await import("@/lib/queries/docs"));
    ({ getClientVisiblePageLinksByTaskIds } = await import("@/lib/queries/page-links"));

    TABLE_FIXTURES = {
    project_phases: {
      markerColumn: "name",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getProjectPhases(pid);
      },
      insert: async (a, pid) => {
        const vMarker = marker("project_phases", "visible");
        const hMarker = marker("project_phases", "hidden");
        const { data: v } = await a
          .from("project_phases")
          .insert({ project_id: pid, name: vMarker, state: "active", client_visible: true })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_phases")
          .insert({ project_id: pid, name: hMarker, state: "active", client_visible: false })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
      setClientVisible: async (a, id, value) => {
        await a.from("project_phases").update({ client_visible: value }).eq("id", id);
      },
    },
    project_decisions: {
      markerColumn: "title",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getProjectDecisions(pid);
      },
      insert: async (a, pid, ctx) => {
        const vMarker = marker("project_decisions", "visible");
        const hMarker = marker("project_decisions", "hidden");
        const { data: v } = await a
          .from("project_decisions")
          .insert({
            project_id: pid,
            title: vMarker,
            decision_type: "content",
            client_visible: true,
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_decisions")
          .insert({
            project_id: pid,
            title: hMarker,
            decision_type: "content",
            client_visible: false,
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    project_assumptions: {
      markerColumn: "text",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getProjectAssumptions(pid);
      },
      insert: async (a, pid) => {
        const vMarker = marker("project_assumptions", "visible");
        const hMarker = marker("project_assumptions", "hidden");
        const { data: v } = await a
          .from("project_assumptions")
          .insert({ project_id: pid, text: vMarker, client_visible: true })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_assumptions")
          .insert({ project_id: pid, text: hMarker, client_visible: false })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    project_metrics: {
      markerColumn: "name",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getProjectMetricsWithLatestSnapshot(pid);
      },
      insert: async (a, pid) => {
        const vMarker = marker("project_metrics", "visible");
        const hMarker = marker("project_metrics", "hidden");
        const { data: v } = await a
          .from("project_metrics")
          .insert({ project_id: pid, name: vMarker, source: "manual", client_visible: true })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_metrics")
          .insert({ project_id: pid, name: hMarker, source: "manual", client_visible: false })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    project_improvements: {
      markerColumn: "area",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getProjectImprovements(pid);
      },
      insert: async (a, pid) => {
        const vMarker = marker("project_improvements", "visible");
        const hMarker = marker("project_improvements", "hidden");
        const { data: v } = await a
          .from("project_improvements")
          .insert({ project_id: pid, area: vMarker, explanation: "x", client_visible: true })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_improvements")
          .insert({ project_id: pid, area: hMarker, explanation: "x", client_visible: false })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    project_links: {
      markerColumn: "label",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getClientVisiblePortalLinks(pid);
      },
      insert: async (a, pid) => {
        const vMarker = marker("project_links", "visible");
        const hMarker = marker("project_links", "hidden");
        const { data: v } = await a
          .from("project_links")
          .insert({
            project_id: pid,
            kind: "other",
            label: vMarker,
            url: "https://example.com/v",
            client_visible: true,
          })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_links")
          .insert({
            project_id: pid,
            kind: "other",
            label: hMarker,
            url: "https://example.com/h",
            client_visible: false,
          })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    project_accounts: {
      markerColumn: "service",
      rpc: async (pid) => {
        activeSession = clientSession;
        return getClientVisiblePortalAccounts(pid);
      },
      insert: async (a, pid) => {
        // `looks_like_credential` forbids secret-shaped strings in
        // `service`/`note` — the marker is a plain word suffix instead.
        const vMarker = `F025 svc visible ${Math.random().toString(36).slice(2, 8)}`;
        const hMarker = `F025 svc hidden ${Math.random().toString(36).slice(2, 8)}`;
        const { data: v } = await a
          .from("project_accounts")
          .insert({
            project_id: pid,
            service: vMarker,
            owner: "agency",
            status: "pending",
            client_visible: true,
          })
          .select("id")
          .single();
        const { data: h } = await a
          .from("project_accounts")
          .insert({
            project_id: pid,
            service: hMarker,
            owner: "agency",
            status: "pending",
            client_visible: false,
          })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    page_links: {
      markerColumn: "label",
      restFilter: () => `task_id=eq.${pageLinksTaskId}`,
      rpc: async () => {
        activeSession = clientSession;
        const result = await getClientVisiblePageLinksByTaskIds([pageLinksTaskId]);
        return result.ok ? (result.data.get(pageLinksTaskId) ?? []) : result;
      },
      insert: async (a, pid, ctx) => {
        const vMarker = marker("page_links", "visible");
        const hMarker = marker("page_links", "hidden");
        const { data: task } = await a
          .from("tasks")
          .insert({
            project_id: pid,
            title: `F025 page_links page ${Math.random().toString(36).slice(2, 8)}`,
            status: "todo",
            author_id: ctx.userId,
            client_visible: true,
          })
          .select("id")
          .single();
        pageLinksTaskId = task!.id;
        const { data: v } = await a
          .from("page_links")
          .insert({
            task_id: pageLinksTaskId,
            kind: "other",
            label: vMarker,
            url: "https://example.com/v",
            client_visible: true,
          })
          .select("id")
          .single();
        const { data: h } = await a
          .from("page_links")
          .insert({
            task_id: pageLinksTaskId,
            kind: "other",
            label: hMarker,
            url: "https://example.com/h",
            client_visible: false,
          })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
      cleanup: async (a) => {
        await a.from("tasks").delete().eq("id", pageLinksTaskId);
      },
    },
    docs: {
      markerColumn: "title",
      // F025e: getClientVisibleDocs (lib/queries/docs.ts) is the
      // portal's own client-facing list-docs query (F023's site page
      // calls it) — this leg was disabled by F025 with a comment that
      // predated that function and is re-enabled here.
      rpc: async (pid) => {
        activeSession = clientSession;
        return getClientVisibleDocs(workspaceId, pid);
      },
      insert: async (a, pid, ctx) => {
        const vMarker = marker("docs", "visible");
        const hMarker = marker("docs", "hidden");
        const { data: v } = await a
          .from("docs")
          .insert({
            workspace_id: ctx.workspaceId,
            project_id: pid,
            title: vMarker,
            created_by: ctx.userId,
            client_visible: true,
          })
          .select("id")
          .single();
        const { data: h } = await a
          .from("docs")
          .insert({
            workspace_id: ctx.workspaceId,
            project_id: pid,
            title: hMarker,
            created_by: ctx.userId,
            client_visible: false,
          })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    tasks: {
      markerColumn: "title",
      // Covered thoroughly at the RPC layer by tests/integration/
      // f005-portal-pages.test.ts and f003-portal-shell.test.ts already
      // (getPortalPages/getPortalOverview); this suite still runs the
      // direct-select and count legs below for completeness of the
      // catalog-derived sweep. Listed in NULL_RPC_ALLOWLIST below so the
      // anti-staleness check doesn't flag it.
      rpc: null,
      insert: async (a, pid, ctx) => {
        const vMarker = marker("tasks", "visible");
        const hMarker = marker("tasks", "hidden");
        const { data: v } = await a
          .from("tasks")
          .insert({ project_id: pid, title: vMarker, author_id: ctx.userId, client_visible: true })
          .select("id")
          .single();
        const { data: h } = await a
          .from("tasks")
          .insert({ project_id: pid, title: hMarker, author_id: ctx.userId, client_visible: false })
          .select("id")
          .single();
        return { visible: { id: v!.id, marker: vMarker }, hidden: { id: h!.id, marker: hMarker } };
      },
    },
    };
  }, 60_000);

  it(
    "catalog: TABLE_FIXTURES covers exactly the tables the live catalog reports as carrying " +
      "a client_visible column — no more, no less (this is the 'a table added later fails " +
      "the suite' mechanism)",
    async () => {
      const rows = await mgmtSql<{ table_name: string }>(`
        select table_name
        from information_schema.columns
        where column_name = 'client_visible' and table_schema = 'public'
        order by table_name;
      `);
      const catalogTables = new Set(rows.map((r) => r.table_name));
      const fixtureTables = new Set(Object.keys(TABLE_FIXTURES));

      const missingFixtures = [...catalogTables].filter((t) => !fixtureTables.has(t));
      const staleFixtures = [...fixtureTables].filter((t) => !catalogTables.has(t));

      expect(
        missingFixtures,
        `Table(s) with a client_visible column and NO fixture in this suite: ${JSON.stringify(missingFixtures)}. ` +
          "Add a TABLE_FIXTURES entry before this can pass — this is the mechanism that " +
          "catches a table added without a leak test.",
      ).toEqual([]);
      expect(
        staleFixtures,
        `Fixture(s) in this suite for a table the catalog no longer reports: ${JSON.stringify(staleFixtures)}`,
      ).toEqual([]);
    },
  );

  // F025e: the check above catches a fixture that's missing entirely. It
  // does NOT catch a fixture whose `rpc` leg has quietly gone stale --
  // exactly what happened to `docs` once F023 added getClientVisibleDocs
  // and nobody updated this suite. `NULL_RPC_ALLOWLIST` is the only
  // place `rpc: null` is allowed to stand unchallenged, each entry
  // carrying its own reason; any other fixture with `rpc: null` fails
  // this test, forcing whoever disables an RPC leg to either wire it up
  // or explain themselves here.
  const NULL_RPC_ALLOWLIST: Record<string, string> = {
    tasks: "covered at the RPC layer by f005-portal-pages.test.ts / f003-portal-shell.test.ts",
  };

  it(
    "anti-staleness: every TABLE_FIXTURES entry with rpc === null is explicitly allowlisted, " +
      "with a reason — a fixture that silently stopped covering its table's RPC leg fails here",
    () => {
      const unexplainedNullRpc = Object.entries(TABLE_FIXTURES)
        .filter(([, cfg]) => cfg.rpc === null)
        .map(([table]) => table)
        .filter((table) => !(table in NULL_RPC_ALLOWLIST));

      expect(
        unexplainedNullRpc,
        `Table(s) whose fixture has rpc: null but no NULL_RPC_ALLOWLIST entry explaining why: ` +
          `${JSON.stringify(unexplainedNullRpc)}. Either wire up the RPC leg (a client-facing ` +
          "query function for this table may now exist, as it did for docs) or add an " +
          "allowlist entry with a reason.",
      ).toEqual([]);

      const allowlistedButCovered = Object.keys(NULL_RPC_ALLOWLIST).filter(
        (table) => TABLE_FIXTURES[table]?.rpc !== null,
      );
      expect(
        allowlistedButCovered,
        `NULL_RPC_ALLOWLIST entry for table(s) whose fixture now has a real rpc — remove the ` +
          `stale allowlist entry: ${JSON.stringify(allowlistedButCovered)}`,
      ).toEqual([]);
    },
  );

  for (const [table, fixture] of Object.entries({
    project_phases: null,
    project_decisions: null,
    project_assumptions: null,
    project_metrics: null,
    project_improvements: null,
    project_links: null,
    project_accounts: null,
    page_links: null,
    docs: null,
    tasks: null,
  })) {
    void fixture;
    it(`test_AS_054_${table}_hidden_row_absent_from_direct_select_count_and_rpc`, async () => {
      const cfg = TABLE_FIXTURES[table];
      const { visible, hidden } = await cfg.insert(admin, projectId, {
        workspaceId,
        userId: ownerId,
      });

      try {
        // 1. Direct select over REST, as the real client session.
        const filter = cfg.restFilter ? cfg.restFilter(projectId) : `project_id=eq.${projectId}`;
        const restUrl = `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=${cfg.markerColumn}`;
        const selectRes = await fetch(restUrl, {
          headers: {
            apikey: PUBLISHABLE_KEY!,
            Authorization: `Bearer ${clientAccessToken}`,
          },
        });
        const selectBody = (await selectRes.json()) as Record<string, unknown>[];
        const selectedMarkers = selectBody.map((r) => r[cfg.markerColumn]);
        expect(
          selectedMarkers,
          `${table}: hidden row's marker leaked through a direct select`,
        ).not.toContain(hidden.marker);
        expect(selectedMarkers).toContain(visible.marker);

        // 2. Aggregate/count via Prefer: count=exact.
        const countRes = await fetch(restUrl, {
          headers: {
            apikey: PUBLISHABLE_KEY!,
            Authorization: `Bearer ${clientAccessToken}`,
            Prefer: "count=exact",
          },
        });
        const contentRange = countRes.headers.get("content-range");
        const total = contentRange ? Number(contentRange.split("/")[1]) : NaN;
        expect(
          total,
          `${table}: count/aggregate includes the hidden row (content-range: ${contentRange})`,
        ).toBe(1);

        // 3. Every RPC the portal itself calls for this table.
        if (cfg.rpc) {
          const rpcResult = await cfg.rpc(projectId);
          const serialised = JSON.stringify(rpcResult);
          expect(
            serialised.includes(hidden.marker),
            `${table}: hidden row's marker leaked through the portal's own RPC/query function`,
          ).toBe(false);
          expect(serialised.includes(visible.marker)).toBe(true);
        }
      } finally {
        await admin.from(table).delete().eq("id", visible.id);
        await admin.from(table).delete().eq("id", hidden.id);
        if (cfg.cleanup) await cfg.cleanup(admin);
      }
    });
  }

  // Definition of done's mandatory failure test: prove the sweep can
  // fail. Uses project_phases (this table's own RPC, getProjectPhases,
  // is a real client-facing portal function, not a stub).
  it(
    "failure test: marking the hidden project_phases row client_visible = true makes the " +
      "same triple detect and report the leak (both direct-select and RPC legs)",
    async () => {
      const cfg = TABLE_FIXTURES.project_phases;
      const { visible, hidden } = await cfg.insert(admin, projectId, {
        workspaceId,
        userId: ownerId,
      });

      try {
        // Sanity: before the flip, the sweep is clean (mirrors the
        // per-table test above for this exact table).
        activeSession = clientSession;
        const before = JSON.stringify(await getProjectPhases(projectId));
        expect(before.includes(hidden.marker)).toBe(false);

        // Flip the "not client-visible" row to client-visible — this is
        // exactly the fixture mutation the Definition of Done asks for.
        await cfg.setClientVisible!(admin, hidden.id, true);

        // Re-run the same two legs. Both must now report the leak.
        const restUrl = `${SUPABASE_URL}/rest/v1/project_phases?project_id=eq.${projectId}&select=name`;
        const selectRes = await fetch(restUrl, {
          headers: { apikey: PUBLISHABLE_KEY!, Authorization: `Bearer ${clientAccessToken}` },
        });
        const selectBody = (await selectRes.json()) as { name: string }[];
        expect(
          selectBody.map((r) => r.name),
          "F025 failure test did not actually fail — the sweep is vacuous",
        ).toContain(hidden.marker);

        activeSession = clientSession;
        const after = JSON.stringify(await getProjectPhases(projectId));
        expect(
          after.includes(hidden.marker),
          "F025 failure test did not actually fail at the RPC leg either",
        ).toBe(true);

        // Revert, per the Definition of Done ("confirm the sweep fails,
        // revert").
        await cfg.setClientVisible!(admin, hidden.id, false);

        activeSession = clientSession;
        const reverted = JSON.stringify(await getProjectPhases(projectId));
        expect(reverted.includes(hidden.marker)).toBe(false);
      } finally {
        await admin.from("project_phases").delete().eq("id", visible.id);
        await admin.from("project_phases").delete().eq("id", hidden.id);
      }
    },
  );
});
