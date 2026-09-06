// Integration test for `project_scope_documents` (20261106010000): the
// Scope & Decisions portal page's "Add document" feature (upload or link
// documents like a Figma proposal or a signed contract).
//
// Same convention as tests/integration/f022-links-accounts-docs-visibility-
// rls.test.ts: real signed-in sessions against PostgREST, not a mocked
// query builder. Uses the shared pooled-identity helper (F126) instead of
// minting fresh auth users, per that helper's own usage note.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPoolIdentity, getPoolSession } from "../helpers/auth";

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

const RLS_DENIED = "42501";
const CHECK_VIOLATION = "23514";

describe.skipIf(!haveCreds)("project_scope_documents RLS", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;
  let outsiderSession: SupabaseClient;

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Pool slots: 0 = owner, 1 = member (team writer), 2 = client,
    // 3 = outsider (no membership at all). Distinct slots from other
    // migrated files' own conventions are fine — a real person legitimately
    // plays different roles in different tests' workspaces.
    const owner = await getPoolIdentity(0);
    const memberUser = await getPoolIdentity(1);
    const clientUser = await getPoolIdentity(2);
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "Scope docs test", slug: `scope-docs-${suffix}` })
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

    memberSession = await getPoolSession(1);
    clientSession = await getPoolSession(2);
    outsiderSession = await getPoolSession(3);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin
      .from("project_scope_documents")
      .delete()
      .in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_members").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
  }, 60_000);

  it("AS: a team member can attach a link-kind scope document", async () => {
    const { data, error } = await memberSession
      .from("project_scope_documents")
      .insert({
        project_id: enabledProjectId,
        title: "Figma proposal",
        kind: "link",
        url: "https://www.figma.com/file/abc123",
        uploaded_by: memberId,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("AS: a client cannot insert a scope document (write RLS is team-only)", async () => {
    const { error } = await clientSession.from("project_scope_documents").insert({
      project_id: enabledProjectId,
      title: "Client-attempted link",
      kind: "link",
      url: "https://example.com/x",
      uploaded_by: clientId,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("CHECK constraint: an 'upload' row must not carry a url, and a 'link' row must not carry a file_path", async () => {
    const { error: uploadWithUrl } = await admin.from("project_scope_documents").insert({
      project_id: enabledProjectId,
      title: "Bad shape",
      kind: "upload",
      file_path: `${enabledProjectId}/somefile.pdf`,
      url: "https://example.com",
      uploaded_by: memberId,
    });
    expect(uploadWithUrl).not.toBeNull();
    expect(uploadWithUrl?.code).toBe(CHECK_VIOLATION);

    const { error: linkWithFilePath } = await admin.from("project_scope_documents").insert({
      project_id: enabledProjectId,
      title: "Bad shape 2",
      kind: "link",
      file_path: `${enabledProjectId}/somefile.pdf`,
      uploaded_by: memberId,
    });
    expect(linkWithFilePath).not.toBeNull();
    expect(linkWithFilePath?.code).toBe(CHECK_VIOLATION);
  });

  describe("AS: client-visible read path — membership, role, AND portal_enabled all required", () => {
    let enabledDocId: string;
    let disabledDocId: string;

    beforeAll(async () => {
      const { data: enabledDoc, error: e1 } = await admin
        .from("project_scope_documents")
        .insert({
          project_id: enabledProjectId,
          title: "Contract (portal on)",
          kind: "link",
          url: "https://example.com/contract",
          uploaded_by: memberId,
        })
        .select("id")
        .single();
      if (e1 || !enabledDoc) throw new Error(`seed enabled doc: ${e1?.message}`);
      enabledDocId = enabledDoc.id;

      const { data: disabledDoc, error: e2 } = await admin
        .from("project_scope_documents")
        .insert({
          project_id: disabledProjectId,
          title: "Contract (portal off)",
          kind: "link",
          url: "https://example.com/contract2",
          uploaded_by: memberId,
        })
        .select("id")
        .single();
      if (e2 || !disabledDoc) throw new Error(`seed disabled doc: ${e2?.message}`);
      disabledDocId = disabledDoc.id;
    });

    it("a client member of a portal-enabled project can read its scope documents", async () => {
      const { data, error } = await clientSession
        .from("project_scope_documents")
        .select("id")
        .eq("id", enabledDocId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data?.id).toBe(enabledDocId);
    });

    it("a client member of a portal-DISABLED project cannot read its scope documents (role+portal_enabled gate, not membership alone)", async () => {
      const { data, error } = await clientSession
        .from("project_scope_documents")
        .select("id")
        .eq("id", disabledDocId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("a non-member (no workspace_members row at all) cannot read any scope document", async () => {
      const { data, error } = await outsiderSession
        .from("project_scope_documents")
        .select("id")
        .eq("id", enabledDocId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("a team member (non-client role) can read scope documents regardless of portal_enabled", async () => {
      const { data, error } = await memberSession
        .from("project_scope_documents")
        .select("id")
        .eq("id", disabledDocId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data?.id).toBe(disabledDocId);
    });
  });

  it("AS: a team member (writer) may delete a scope document they can see", async () => {
    const { data: created, error: createError } = await memberSession
      .from("project_scope_documents")
      .insert({
        project_id: enabledProjectId,
        title: "To be deleted",
        kind: "link",
        url: "https://example.com/delete-me",
        uploaded_by: memberId,
      })
      .select("id")
      .single();
    expect(createError).toBeNull();
    expect(created?.id).toBeTruthy();

    const { error: deleteError } = await memberSession
      .from("project_scope_documents")
      .delete()
      .eq("id", created!.id);
    expect(deleteError).toBeNull();

    const { data: afterDelete } = await admin
      .from("project_scope_documents")
      .select("id")
      .eq("id", created!.id)
      .maybeSingle();
    expect(afterDelete).toBeNull();
  });

  it("a client cannot delete a scope document", async () => {
    const { data: created, error: createError } = await admin
      .from("project_scope_documents")
      .insert({
        project_id: enabledProjectId,
        title: "Client cannot delete this",
        kind: "link",
        url: "https://example.com/keep",
        uploaded_by: memberId,
      })
      .select("id")
      .single();
    expect(createError).toBeNull();

    const { error: deleteError, count } = await clientSession
      .from("project_scope_documents")
      .delete({ count: "exact" })
      .eq("id", created!.id);

    // RLS-filtered delete affects 0 rows rather than erroring outright.
    expect(deleteError).toBeNull();
    expect(count).toBe(0);

    const { data: stillThere } = await admin
      .from("project_scope_documents")
      .select("id")
      .eq("id", created!.id)
      .maybeSingle();
    expect(stillThere?.id).toBe(created!.id);
  });
});
