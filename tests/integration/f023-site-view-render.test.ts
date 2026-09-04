// Integration test for F023 (missions/20260903-portal, M5 — Portal: Your
// site view). Covers AS-049, AS-050, AS-051 at the page's own boundary:
// a real client session reads `project_links`/`project_accounts`/`docs`
// exactly the way `getProjectLinks`/`getProjectAccounts`/`getAllDocs`
// do (RLS-scoped, no extra client-side filter beyond `doc_kind ===
// 'training'`, which this file applies the same way the page itself
// does), and the result is fed through the page's own render
// components (`ProjectLinksList`, `ProjectAccountsTable`,
// `ProjectGuidesList`) with `renderToStaticMarkup` -- the same
// real-session, no-mocked-query-builder convention
// f022-links-accounts-docs-visibility-rls.test.ts already established,
// extended one layer further into the actual UI so "renders only
// client-visible" is proven against rendered output, not just the query
// result.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ProjectLinksList } from "@/components/portal/project-links-list";
import { ProjectAccountsTable } from "@/components/portal/project-accounts-table";
import { ProjectGuidesList } from "@/components/portal/project-guides-list";
import type { ProjectLink, ProjectAccount } from "@/lib/queries/project-site";
import type { Doc } from "@/lib/queries/docs";

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

function toProjectLink(row: {
  id: string;
  project_id: string;
  kind: string;
  label: string;
  url: string;
  client_visible: boolean;
  position: number;
}): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as ProjectLink["kind"],
    label: row.label,
    url: row.url,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

function toProjectAccount(row: {
  id: string;
  project_id: string;
  service: string;
  owner: string;
  status: string;
  renewal_date: string | null;
  note: string | null;
  client_visible: boolean;
  position: number;
}): ProjectAccount {
  return {
    id: row.id,
    projectId: row.project_id,
    service: row.service,
    owner: row.owner as ProjectAccount["owner"],
    status: row.status as ProjectAccount["status"],
    renewalDate: row.renewal_date,
    note: row.note,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

function toDoc(row: {
  id: string;
  workspace_id: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  content: string;
  position: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  client_visible: boolean;
  doc_kind: string;
}): Doc {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    folderId: row.folder_id,
    title: row.title,
    content: row.content,
    position: row.position,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientVisible: row.client_visible,
    docKind: row.doc_kind as Doc["docKind"],
  };
}

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
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
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
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
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

  it("test_AS_049_the_view_renders_only_the_client_visible_link_and_its_hidden_sibling_url_appears_nowhere", async () => {
    const { data, error } = await clientSession
      .from("project_links")
      .select("id, project_id, kind, label, url, client_visible, position")
      .eq("project_id", projectId)
      .order("position", { ascending: true });
    expect(error).toBeNull();

    const links = (data ?? []).map(toProjectLink);
    expect(links.map((l) => l.id)).toEqual([visibleLinkId]);

    const html = renderToStaticMarkup(createElement(ProjectLinksList, { links }));

    expect(html).toContain("nordvik.webflow.io");
    expect(html).toContain("https://nordvik.webflow.io");
    // The failure test: the hidden link's URL is absent from the payload
    // AND the rendered output, not merely unlisted.
    expect(html).not.toContain("figma.com/file/secret-internal-xyz");
    expect(JSON.stringify(links)).not.toContain("figma.com/file/secret-internal-xyz");

    // External links open in a new tab with rel="noopener noreferrer".
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("test_AS_050_the_view_renders_only_the_client_visible_account_and_hides_owner_status_for_the_rest", async () => {
    const { data, error } = await clientSession
      .from("project_accounts")
      .select("id, project_id, service, owner, status, renewal_date, note, client_visible, position")
      .eq("project_id", projectId)
      .order("position", { ascending: true });
    expect(error).toBeNull();

    const accounts = (data ?? []).map(toProjectAccount);
    expect(accounts.map((a) => a.id)).toEqual([visibleAccountId]);

    const html = renderToStaticMarkup(createElement(ProjectAccountsTable, { accounts }));

    expect(html).toContain("Domain registrar");
    expect(html).toContain("You own this");
    expect(html).not.toContain("Internal billing tool");
  });

  it("test_AS_051_the_view_renders_only_client_visible_training_docs_as_guides_and_excludes_other_kinds", async () => {
    const { data, error } = await clientSession
      .from("docs")
      .select(
        "id, workspace_id, project_id, folder_id, title, content, position, created_by, updated_by, created_at, updated_at, client_visible, doc_kind",
      )
      .eq("project_id", projectId)
      .order("position", { ascending: true });
    expect(error).toBeNull();

    const allVisibleDocs = (data ?? []).map(toDoc);
    // RLS already excludes both the hidden training doc and anything on a
    // portal-disabled/invisible project; the process doc proves the page's
    // own doc_kind filter (not RLS) is what keeps a client_visible
    // non-training doc out of Guides.
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

  it("an empty guides list explains training arrives at handover, not that the section is broken", () => {
    const html = renderToStaticMarkup(createElement(ProjectGuidesList, { guides: [] }));
    expect(html).toContain("Training guides arrive at handover.");
  });
});
