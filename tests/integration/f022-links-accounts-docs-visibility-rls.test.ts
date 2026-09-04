// Integration test for F022 (missions/20260903-portal, M5 — Site, guides,
// trust): `project_links`, `project_accounts`, and the docs client read
// path (`docs.client_visible`, `docs.doc_kind`). Covers AS-049, AS-050,
// AS-051.
//
// Same convention as tests/integration/f012-deliverables-scope-decisions-
// assumptions-rls.test.ts: real signed-in sessions against PostgREST, not
// a mocked query builder.

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
const CHECK_VIOLATION = "23514";

describe.skipIf(!haveCreds)("project_links / project_accounts / docs client visibility", () => {
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
        email: `f022-site-${label}-${suffix}@example.com`,
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
      .insert({ name: "F022 site test", slug: `f022-site-${suffix}` })
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
    await admin.from("project_links").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_accounts").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("docs").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_members").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // --- AS-049: project_links ----------------------------------------------

  describe("AS-049: a project can record links with per-link client visibility", () => {
    let visibleLinkId: string;
    let hiddenLinkId: string;

    beforeAll(async () => {
      const { data: visible, error: visibleErr } = await admin
        .from("project_links")
        .insert({
          project_id: enabledProjectId,
          kind: "staging",
          label: "Staging",
          url: "https://staging.example.com",
          client_visible: true,
          position: 1,
        })
        .select("id")
        .single();
      if (visibleErr || !visible) throw new Error(`link: ${visibleErr?.message}`);
      visibleLinkId = visible.id;

      const { data: hidden, error: hiddenErr } = await admin
        .from("project_links")
        .insert({
          project_id: enabledProjectId,
          kind: "figma",
          label: "Design file",
          url: "https://figma.com/file/xyz",
          position: 2,
        })
        .select("id, client_visible")
        .single();
      if (hiddenErr || !hidden) throw new Error(`link: ${hiddenErr?.message}`);
      hiddenLinkId = hidden.id;
      // AS-049's own default: a link added without an explicit
      // client_visible value must default to false.
      expect(hidden.client_visible).toBe(false);
    });

    it("rejects a kind outside the closed vocabulary", async () => {
      const { error } = await admin.from("project_links").insert({
        project_id: enabledProjectId,
        kind: "not_a_real_kind",
        label: "Bad kind",
        url: "https://example.com",
        position: 99,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("a client on a portal-enabled project reads only the client-visible link", async () => {
      const { data, error } = await clientSession
        .from("project_links")
        .select("id")
        .eq("project_id", enabledProjectId);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([visibleLinkId]);
    });

    it("a client cannot fetch the hidden link by direct id either", async () => {
      const { data, error } = await clientSession
        .from("project_links")
        .select("id")
        .eq("id", hiddenLinkId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a team member reads both links", async () => {
      const { data, error } = await memberSession
        .from("project_links")
        .select("id")
        .eq("project_id", enabledProjectId);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id).sort()).toEqual(
        [visibleLinkId, hiddenLinkId].sort(),
      );
    });

    it("a client has no INSERT/UPDATE/DELETE path", async () => {
      const insert = await clientSession.from("project_links").insert({
        project_id: enabledProjectId,
        kind: "other",
        label: "Client-authored",
        url: "https://example.com",
        position: 3,
      });
      expect(insert.error?.code).toBe(RLS_DENIED);

      const { data: updated, error: updateErr } = await clientSession
        .from("project_links")
        .update({ label: "Hijacked" })
        .eq("id", visibleLinkId)
        .select("id");
      expect(updateErr).toBeNull();
      expect(updated).toEqual([]);

      const { data: deleted, error: deleteErr } = await clientSession
        .from("project_links")
        .delete()
        .eq("id", visibleLinkId)
        .select("id");
      expect(deleteErr).toBeNull();
      expect(deleted).toEqual([]);
    });

    it("a client on a portal-disabled project sees nothing, even for a client-visible link", async () => {
      const { data: disabledLink, error: insertErr } = await admin
        .from("project_links")
        .insert({
          project_id: disabledProjectId,
          kind: "live",
          label: "Live",
          url: "https://example.com",
          client_visible: true,
          position: 1,
        })
        .select("id")
        .single();
      if (insertErr || !disabledLink) throw new Error(`link: ${insertErr?.message}`);

      const { data, error } = await clientSession
        .from("project_links")
        .select("id")
        .eq("id", disabledLink.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // --- AS-050: project_accounts --------------------------------------------

  describe("AS-050: a project can record accounts with an owner and a transfer status, and rejects a credential value", () => {
    let accountId: string;

    beforeAll(async () => {
      const { data, error } = await admin
        .from("project_accounts")
        .insert({
          project_id: enabledProjectId,
          service: "Domain registrar",
          owner: "client",
          status: "pending",
          position: 1,
        })
        .select("id, client_visible")
        .single();
      if (error || !data) throw new Error(`account: ${error?.message}`);
      accountId = data.id;
      // AS-050's own default: project_accounts.client_visible defaults
      // true, unlike project_links (this table answers "what do I
      // actually own", which the client asks about by default).
      expect(data.client_visible).toBe(true);
    });

    it("rejects an owner outside the closed vocabulary", async () => {
      const { error } = await admin.from("project_accounts").insert({
        project_id: enabledProjectId,
        service: "Bad owner",
        owner: "vendor",
        status: "pending",
        position: 98,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("rejects a status outside the closed vocabulary", async () => {
      const { error } = await admin.from("project_accounts").insert({
        project_id: enabledProjectId,
        service: "Bad status",
        owner: "agency",
        status: "done",
        position: 97,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    // AS-050's failure test: a value matching a secret shape is rejected
    // by the CHECK constraint, on both free-text columns.
    const secretShapes = [
      "sk_live_51H8x9yzABCDEFGHIJ1234567890",
      "ghp_1234567890abcdefghijklmnopqrstuv",
      "-----BEGIN PRIVATE KEY-----",
      "aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkaGVsbG93b3JsZA==",
    ];

    it.each(secretShapes)(
      "rejects a service value shaped like a credential: %s",
      async (secret) => {
        const { error } = await admin.from("project_accounts").insert({
          project_id: enabledProjectId,
          service: secret,
          owner: "agency",
          status: "pending",
          position: 96,
        });
        expect(error).not.toBeNull();
        expect(error?.code).toBe(CHECK_VIOLATION);
      },
    );

    it.each(secretShapes)("rejects a note value shaped like a credential: %s", async (secret) => {
      const { error } = await admin.from("project_accounts").insert({
        project_id: enabledProjectId,
        service: "GA4",
        owner: "agency",
        status: "pending",
        note: secret,
        position: 95,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("accepts an ordinary service name and note", async () => {
      const { error } = await admin.from("project_accounts").insert({
        project_id: enabledProjectId,
        service: "Webflow",
        owner: "agency",
        status: "provisioned",
        note: "Transferred to the client's own Webflow workspace after handover.",
        position: 94,
      });
      expect(error).toBeNull();
    });

    it("a client on a portal-enabled project reads it with its owner and status", async () => {
      const { data, error } = await clientSession
        .from("project_accounts")
        .select("id, owner, status")
        .eq("id", accountId)
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ owner: "client", status: "pending" });
    });

    it("a hidden account is absent from a client's select", async () => {
      const { data: hidden, error: insertErr } = await admin
        .from("project_accounts")
        .insert({
          project_id: enabledProjectId,
          service: "Internal monitoring",
          owner: "agency",
          status: "provisioned",
          client_visible: false,
          position: 2,
        })
        .select("id")
        .single();
      if (insertErr || !hidden) throw new Error(`account: ${insertErr?.message}`);

      const { data, error } = await clientSession
        .from("project_accounts")
        .select("id")
        .eq("id", hidden.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a client has no INSERT/UPDATE/DELETE path", async () => {
      const insert = await clientSession.from("project_accounts").insert({
        project_id: enabledProjectId,
        service: "Client-authored",
        owner: "client",
        status: "pending",
        position: 3,
      });
      expect(insert.error?.code).toBe(RLS_DENIED);

      const { data: updated, error: updateErr } = await clientSession
        .from("project_accounts")
        .update({ status: "transferred" })
        .eq("id", accountId)
        .select("id");
      expect(updateErr).toBeNull();
      expect(updated).toEqual([]);

      const { data: deleted, error: deleteErr } = await clientSession
        .from("project_accounts")
        .delete()
        .eq("id", accountId)
        .select("id");
      expect(deleteErr).toBeNull();
      expect(deleted).toEqual([]);
    });
  });

  // --- AS-051: docs client visibility --------------------------------------

  describe("AS-051: a document can be marked visible to the client and given a kind, and only client-visible docs reach the portal", () => {
    let visibleDocId: string;
    let hiddenDocId: string;
    let ownerUserId: string;

    beforeAll(async () => {
      ownerUserId = ownerId;

      const { data: visible, error: visibleErr } = await admin
        .from("docs")
        .insert({
          workspace_id: workspaceId,
          project_id: enabledProjectId,
          title: "How to update the homepage",
          content: "Step by step...",
          doc_kind: "training",
          client_visible: true,
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      if (visibleErr || !visible) throw new Error(`doc: ${visibleErr?.message}`);
      visibleDocId = visible.id;

      const { data: hidden, error: hiddenErr } = await admin
        .from("docs")
        .insert({
          workspace_id: workspaceId,
          project_id: enabledProjectId,
          title: "Internal launch checklist",
          content: "Do not share...",
          created_by: ownerUserId,
        })
        .select("id, client_visible, doc_kind")
        .single();
      if (hiddenErr || !hidden) throw new Error(`doc: ${hiddenErr?.message}`);
      hiddenDocId = hidden.id;
      // A doc's default stays exactly what the docs system had before
      // this feature: not shared, plain "note" kind.
      expect(hidden.client_visible).toBe(false);
      expect(hidden.doc_kind).toBe("note");
    });

    it("rejects a doc_kind outside the closed vocabulary", async () => {
      const { error } = await admin.from("docs").insert({
        workspace_id: workspaceId,
        project_id: enabledProjectId,
        title: "Bad kind",
        doc_kind: "manual",
        created_by: ownerUserId,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("a client on a portal-enabled project reads only the client-visible doc, with its kind", async () => {
      const { data, error } = await clientSession
        .from("docs")
        .select("id, doc_kind")
        .eq("project_id", enabledProjectId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: visibleDocId, doc_kind: "training" }]);
    });

    it("a non-client-visible doc is absent from a client's select by direct id", async () => {
      const { data, error } = await clientSession.from("docs").select("id").eq("id", hiddenDocId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a client on a portal-disabled project sees no docs at all, even a client-visible one", async () => {
      const { data: disabledDoc, error: insertErr } = await admin
        .from("docs")
        .insert({
          workspace_id: workspaceId,
          project_id: disabledProjectId,
          title: "Portal-off guide",
          doc_kind: "process",
          client_visible: true,
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      if (insertErr || !disabledDoc) throw new Error(`doc: ${insertErr?.message}`);

      const { data, error } = await clientSession.from("docs").select("id").eq("id", disabledDoc.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a workspace-level doc (no project) is never reachable by a client, even if flagged client_visible", async () => {
      const { data: workspaceDoc, error: insertErr } = await admin
        .from("docs")
        .insert({
          workspace_id: workspaceId,
          project_id: null,
          title: "Workspace-level doc",
          client_visible: true,
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      if (insertErr || !workspaceDoc) throw new Error(`doc: ${insertErr?.message}`);

      const { data, error } = await clientSession
        .from("docs")
        .select("id")
        .eq("id", workspaceDoc.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a team member still reads every doc regardless of client_visible (existing team policy unchanged)", async () => {
      const { data, error } = await memberSession
        .from("docs")
        .select("id")
        .eq("project_id", enabledProjectId);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id).sort()).toEqual(
        [visibleDocId, hiddenDocId].sort(),
      );
    });

    it("a client has no write path to client_visible or doc_kind", async () => {
      const { data: updated, error } = await clientSession
        .from("docs")
        .update({ client_visible: true, doc_kind: "handover" })
        .eq("id", hiddenDocId)
        .select("id");
      expect(error).toBeNull();
      expect(updated).toEqual([]);

      const { data: unchanged } = await admin
        .from("docs")
        .select("client_visible, doc_kind")
        .eq("id", hiddenDocId)
        .single();
      expect(unchanged).toMatchObject({ client_visible: false, doc_kind: "note" });
    });
  });
});
