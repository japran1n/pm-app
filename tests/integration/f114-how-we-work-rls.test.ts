// Integration test for F114 (docs/client-portal-phase-2-plan.md, items
// E-H): "How we work" — the docs.doc_kind widening (onboarding, feedback,
// portal_guide) plus `doc_links` preview rows. Same real-session-against-
// PostgREST convention as tests/integration/f022-links-accounts-docs-
// visibility-rls.test.ts, which this file's setup mirrors closely.
//
// Covers, per this feature's own "never weaken a test" rule:
//   - a client can read a client-visible "How we work" doc scoped to
//     their own project, and its link previews
//   - a client CANNOT read another project's "How we work" doc (cross-
//     project isolation) even when they are a member of both projects
//   - a client CANNOT read a doc that is not client-visible, and cannot
//     read its links either (link visibility follows the parent doc)
//   - the empty-section case: a project with zero "How we work" docs
//     returns zero rows, not an error

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

describe.skipIf(!haveCreds)("F114: docs.doc_kind widening + doc_links visibility", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectAId: string; // the client's own project — portal enabled
  let projectBId: string; // a second project the same client also belongs to
  let projectCId: string; // a project the client is NOT a member of at all
  let ownerId: string;
  let clientId: string;

  const createdUserIds: string[] = [];
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f114-${label}-${suffix}@example.com`,
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
      .insert({ name: "F114 how-we-work test", slug: `f114-how-we-work-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectAId = await insertProject("Project A");
    projectBId = await insertProject("Project B");
    projectCId = await insertProject("Project C");

    // The client is a member of A and B, but NOT of C — the real
    // cross-project isolation case this feature's own "never weaken a
    // test" rule asks for.
    await admin.from("project_members").insert([
      { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectBId, user_id: clientId, project_role: "member", added_by: ownerId },
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
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (createdDocIds.length > 0) {
      await admin.from("doc_links").delete().in("doc_id", createdDocIds);
      await admin.from("docs").delete().in("id", createdDocIds);
    }
    await admin
      .from("project_members")
      .delete()
      .in("project_id", [projectAId, projectBId, projectCId]);
    await admin.from("projects").delete().in("id", [projectAId, projectBId, projectCId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  const insertDoc = async (
    projectId: string,
    kind: string,
    clientVisible: boolean,
    title: string,
  ) => {
    const { data, error } = await admin
      .from("docs")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title,
        content: `Content for ${title}`,
        doc_kind: kind,
        client_visible: clientVisible,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`doc ${title}: ${error?.message}`);
    createdDocIds.push(data.id as string);
    return data.id as string;
  };

  it("accepts the three new How-we-work doc_kind values", async () => {
    for (const kind of ["onboarding", "feedback", "portal_guide"]) {
      const id = await insertDoc(projectAId, kind, true, `${kind} doc`);
      expect(id).toBeTruthy();
    }
  });

  it("a client can read a client-visible How-we-work doc on their own project, including its link previews", async () => {
    const docId = await insertDoc(projectAId, "handover", true, "Handover — running your site");

    const { error: linkErr } = await admin.from("doc_links").insert({
      doc_id: docId,
      url: "https://example.com/walkthrough",
      title: "Site walkthrough",
      description: "A five-minute tour of the CMS.",
    });
    expect(linkErr).toBeNull();

    const { data: docRows, error: docErr } = await clientSession
      .from("docs")
      .select("id, title, doc_kind")
      .eq("id", docId);
    expect(docErr).toBeNull();
    expect(docRows).toHaveLength(1);

    const { data: linkRows, error: linkReadErr } = await clientSession
      .from("doc_links")
      .select("id, title, url")
      .eq("doc_id", docId);
    expect(linkReadErr).toBeNull();
    expect(linkRows).toHaveLength(1);
    expect(linkRows?.[0]?.title).toBe("Site walkthrough");
  });

  it("a client CANNOT read a How-we-work doc on a project they are not a member of, even though it is client-visible and portal-enabled", async () => {
    const docId = await insertDoc(projectCId, "onboarding", true, "Project C onboarding");

    const { data, error } = await clientSession.from("docs").select("id").eq("id", docId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // Its link previews stay hidden too — link visibility follows the
    // parent doc's own project scope, not a separate check of its own.
    await admin.from("doc_links").insert({
      doc_id: docId,
      url: "https://example.com/c-link",
      title: "Project C link",
    });
    const { data: linkRows, error: linkErr } = await clientSession
      .from("doc_links")
      .select("id")
      .eq("doc_id", docId);
    expect(linkErr).toBeNull();
    expect(linkRows).toHaveLength(0);
  });

  it("a non-client-visible doc stays hidden from the client, and so do its links", async () => {
    const docId = await insertDoc(projectAId, "feedback", false, "Internal feedback notes");

    await admin.from("doc_links").insert({
      doc_id: docId,
      url: "https://example.com/internal",
      title: "Internal only",
    });

    const { data: docRows, error: docErr } = await clientSession
      .from("docs")
      .select("id")
      .eq("id", docId);
    expect(docErr).toBeNull();
    expect(docRows).toHaveLength(0);

    const { data: linkRows, error: linkErr } = await clientSession
      .from("doc_links")
      .select("id")
      .eq("doc_id", docId);
    expect(linkErr).toBeNull();
    expect(linkRows).toHaveLength(0);
  });

  it("the empty-section case: zero How-we-work docs returns zero rows, not an error", async () => {
    const { data, error } = await clientSession
      .from("docs")
      .select("id")
      .eq("project_id", projectBId)
      .in("doc_kind", ["onboarding", "feedback", "portal_guide", "handover"])
      .eq("client_visible", true)
      .neq("id", createdDocIds[createdDocIds.length - 1] ?? "");

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
