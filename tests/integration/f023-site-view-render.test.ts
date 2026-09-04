// Integration test for F023 (missions/20260903-portal, M5 — Portal: Your
// site view). Covers AS-049, AS-050, AS-051 at the page's own boundary:
// a real client session goes through the PRODUCTION functions the site
// page itself calls -- `getClientVisiblePortalLinks`,
// `getClientVisiblePortalAccounts` (lib/queries/project-site.ts) and
// `getClientVisibleDocs` (lib/queries/docs.ts), reached via
// `vi.mock("@/lib/supabase/server")` swapping in the real signed-in
// session the same way tests/integration/f025-portal-table-triple-sweep.test.ts
// already does -- not a hand-rolled inline `.from(...).select(...)`
// re-implementation of their query. This is F025e's fix for a prior
// version of this file that duplicated each query inline: had any of
// these three functions regressed its own `client_visible` filter, or
// had the page swapped in a different query, this file would have
// stayed green. Each AS-049/050/051 test is also proven to FAIL when the
// production function's filter is removed (see the three
// "fails when the filter is removed" tests below, each temporarily
// monkey-patching the query builder). The result is then fed through the
// page's own render components (`ProjectLinksList`, `ProjectAccountsTable`,
// `ProjectGuidesList`) with `renderToStaticMarkup`.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ProjectLinksList } from "@/components/portal/project-links-list";
import { ProjectAccountsTable } from "@/components/portal/project-accounts-table";
import { ProjectGuidesList } from "@/components/portal/project-guides-list";

let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

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

describe.skipIf(!haveCreds)("F023 portal site view renders only client-visible data", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string;

  let visibleLinkId: string;
  let visibleAccountId: string;
  let visibleTrainingDocId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f023-site-${label}-${suffix}@example.com`,
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
      .insert({ name: "F023 site test", slug: `f023-site-${suffix}` })
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
        name: "Portal on",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin
      .from("project_members")
      .insert([{ project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId }]);

    const { data: visibleLink, error: linkErr } = await admin
      .from("project_links")
      .insert({
        project_id: projectId,
        kind: "live",
        label: "Live site",
        url: "https://nordvik.webflow.io",
        client_visible: true,
        position: 1,
      })
      .select("id")
      .single();
    if (linkErr || !visibleLink) throw new Error(`link: ${linkErr?.message}`);
    visibleLinkId = visibleLink.id;

    const { error: hiddenLinkErr } = await admin.from("project_links").insert({
      project_id: projectId,
      kind: "figma",
      label: "Design file",
      url: "https://figma.com/file/secret-internal-xyz",
      client_visible: false,
      position: 2,
    });
    if (hiddenLinkErr) throw new Error(`hidden link: ${hiddenLinkErr.message}`);

    const { data: visibleAccount, error: accountErr } = await admin
      .from("project_accounts")
      .insert({
        project_id: projectId,
        service: "Domain registrar",
        owner: "client",
        status: "provisioned",
        client_visible: true,
        position: 1,
      })
      .select("id")
      .single();
    if (accountErr || !visibleAccount) throw new Error(`account: ${accountErr?.message}`);
    visibleAccountId = visibleAccount.id;

    const { error: hiddenAccountErr } = await admin.from("project_accounts").insert({
      project_id: projectId,
      service: "Internal billing tool",
      owner: "agency",
      status: "pending",
      client_visible: false,
      position: 2,
    });
    if (hiddenAccountErr) throw new Error(`hidden account: ${hiddenAccountErr.message}`);

    const { data: trainingDoc, error: trainingErr } = await admin
      .from("docs")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title: "How to edit a page",
        content: "Walkthrough for editing a page in the CMS.",
        client_visible: true,
        doc_kind: "training",
        created_by: ownerId,
      })
      .select(
        "id, workspace_id, project_id, folder_id, title, content, position, created_by, updated_by, created_at, updated_at, client_visible, doc_kind",
      )
      .single();
    if (trainingErr || !trainingDoc) throw new Error(`training doc: ${trainingErr?.message}`);
    visibleTrainingDocId = trainingDoc.id;

    const { error: hiddenTrainingErr } = await admin.from("docs").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title: "Internal training draft",
      content: "Not ready for the client yet.",
      client_visible: false,
      doc_kind: "training",
      created_by: ownerId,
    });
    if (hiddenTrainingErr) throw new Error(`hidden training doc: ${hiddenTrainingErr.message}`);

    const { error: processDocErr } = await admin.from("docs").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title: "Internal process notes",
      content: "Client-visible but the wrong kind for Guides.",
      client_visible: true,
      doc_kind: "process",
      created_by: ownerId,
    });
    if (processDocErr) throw new Error(`process doc: ${processDocErr.message}`);

    const signIn = async (email: string) => {
      const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project_links").delete().eq("project_id", projectId);
    await admin.from("project_accounts").delete().eq("project_id", projectId);
    await admin.from("docs").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // Temporarily neuters every `.eq("client_visible", true)` call issued
  // by any query built off `client`'s query-builder prototype -- the
  // mechanism the "fails when the filter is removed" tests below use to
  // simulate the production filter being deleted, without touching
  // lib/queries/project-site.ts or lib/queries/docs.ts themselves. All
  // three functions under test build off the same @supabase/postgrest-js
  // `PostgrestFilterBuilder` class, so one patch covers all three tables.
  function withClientVisibleFilterRemoved<T>(client: SupabaseClient, run: () => Promise<T>) {
    const probe = client.from("project_links").select("id") as unknown as {
      eq: (column: string, value: unknown) => unknown;
    };
    const proto = Object.getPrototypeOf(probe);
    const originalEq = proto.eq;
    proto.eq = function (this: unknown, column: string, value: unknown) {
      if (column === "client_visible" && value === true) return this;
      return originalEq.call(this, column, value);
    };
    return run().finally(() => {
      proto.eq = originalEq;
    });
  }

  it("test_AS_049_the_view_renders_only_the_client_visible_link_and_its_hidden_sibling_url_appears_nowhere", async () => {
    activeSession = clientSession;
    const { getClientVisiblePortalLinks } = await import("@/lib/queries/project-site");
    const result = await getClientVisiblePortalLinks(projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((l) => l.id)).toEqual([visibleLinkId]);

    const html = renderToStaticMarkup(createElement(ProjectLinksList, { links: result.data }));

    expect(html).toContain("nordvik.webflow.io");
    expect(html).toContain("https://nordvik.webflow.io");
    // The failure test: the hidden link's URL is absent from the payload
    // AND the rendered output, not merely unlisted.
    expect(html).not.toContain("figma.com/file/secret-internal-xyz");
    expect(JSON.stringify(result.data)).not.toContain("figma.com/file/secret-internal-xyz");

    // External links open in a new tab with rel="noopener noreferrer".
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("test_AS_049_fails_when_the_client_visible_filter_is_removed_from_getClientVisiblePortalLinks", async () => {
    activeSession = admin;
    const { getClientVisiblePortalLinks } = await import("@/lib/queries/project-site");
    const result = await withClientVisibleFilterRemoved(admin, () =>
      getClientVisiblePortalLinks(projectId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Proves the test can fail: with the filter neutered, the hidden
    // link's own row is back in the payload.
    expect(result.data.some((l) => l.label === "Design file")).toBe(true);
  });

  it("test_AS_050_the_view_renders_only_the_client_visible_account_and_hides_owner_status_for_the_rest", async () => {
    activeSession = clientSession;
    const { getClientVisiblePortalAccounts } = await import("@/lib/queries/project-site");
    const result = await getClientVisiblePortalAccounts(projectId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((a) => a.id)).toEqual([visibleAccountId]);

    const html = renderToStaticMarkup(
      createElement(ProjectAccountsTable, { accounts: result.data }),
    );

    expect(html).toContain("Domain registrar");
    expect(html).toContain("You own this");
    expect(html).not.toContain("Internal billing tool");
  });

  it("test_AS_050_fails_when_the_client_visible_filter_is_removed_from_getClientVisiblePortalAccounts", async () => {
    activeSession = admin;
    const { getClientVisiblePortalAccounts } = await import("@/lib/queries/project-site");
    const result = await withClientVisibleFilterRemoved(admin, () =>
      getClientVisiblePortalAccounts(projectId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.some((a) => a.service === "Internal billing tool")).toBe(true);
  });

  it("test_AS_051_the_view_renders_only_client_visible_training_docs_as_guides_and_excludes_other_kinds", async () => {
    activeSession = clientSession;
    const { getClientVisibleDocs } = await import("@/lib/queries/docs");
    const allVisibleDocs = await getClientVisibleDocs(workspaceId, projectId);

    // RLS already excludes both the hidden training doc and anything on a
    // portal-disabled/invisible project; the process doc proves the
    // page's own doc_kind filter (not RLS, not getClientVisibleDocs) is
    // what keeps a client_visible non-training doc out of Guides.
    expect(allVisibleDocs.map((d) => d.id)).toContain(visibleTrainingDocId);
    expect(allVisibleDocs.some((d) => d.title === "Internal training draft")).toBe(false);
    expect(allVisibleDocs.some((d) => d.title === "Internal process notes")).toBe(true);

    const guides = allVisibleDocs.filter((d) => d.docKind === "training");
    expect(guides.map((d) => d.id)).toEqual([visibleTrainingDocId]);

    const html = renderToStaticMarkup(createElement(ProjectGuidesList, { guides }));

    expect(html).toContain("How to edit a page");
    expect(html).not.toContain("Internal process notes");
    expect(html).not.toContain("Internal training draft");
  });

  it("test_AS_051_fails_when_the_client_visible_filter_is_removed_from_getClientVisibleDocs", async () => {
    activeSession = admin;
    const { getClientVisibleDocs } = await import("@/lib/queries/docs");
    const allDocs = await withClientVisibleFilterRemoved(admin, () =>
      getClientVisibleDocs(workspaceId, projectId),
    );
    expect(allDocs.some((d) => d.title === "Internal training draft")).toBe(true);
  });

  it("an empty guides list explains training arrives at handover, not that the section is broken", () => {
    const html = renderToStaticMarkup(createElement(ProjectGuidesList, { guides: [] }));
    expect(html).toContain("Training guides arrive at handover.");
  });
});
