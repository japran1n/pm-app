// Integration test for F003/F024 (AS-008), run against the real linked
// Supabase project — mirrors the pattern established by
// tests/integration/palette-search-private-project-leak.test.ts.
//
// M1-SCRUTINY.md B2: the mocked unit tests for get_current_doc
// (lib/ai/tools/__tests__/get-current-doc.test.ts) assert against their
// own mocks — `test_AS_008_doc_in_another_workspace_returns_empty_and_leaks_nothing`
// was byte-identical to the plain not-found case; neither would fail if
// RLS were dropped entirely or a service-role client were used instead of
// the RLS-scoped session client. This test proves the real property
// end-to-end, not by code review alone: a real user who is an active
// member of workspace A, calling get_current_doc with the real id of a
// document that genuinely exists in workspace B (which they are not a
// member of), gets the exact same empty/"not_found" result the tool
// returns for a document id that doesn't exist at all — an actual RLS
// denial, not a filtered mock.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  PUBLISHABLE_KEY,
  shouldRunLiveDbTests,
  createAdminClient,
  sweepLeakedFixtures,
} from "./support/live-db";

// F031: these suites only run when explicit opt-in
// (AI_DOCS_LIVE_DB_TESTS=1) or CI is set, on top of having admin
// credentials — see tests/integration/support/live-db.ts. An ordinary
// `npm test` run with `.env` pointed at a live project no longer seeds it.
const LEAK_PREFIXES = ["f024-", "f027-"];

let callerSessionClient: SupabaseClient | null = null;

import { vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => callerSessionClient,
}));

describe.skipIf(!shouldRunLiveDbTests)(
  "get_current_doc denies access to a document in a workspace the caller is not a member of (F024: AS-008)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let callerUserId: string;
    let ownerBUserId: string;
    let foreignDocId: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const callerEmail = `f024-get-doc-caller-${uniqueSuffix}@example.com`;
      const ownerEmail = `f024-get-doc-owner-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";

      const { data: callerAuth, error: callerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: callerEmail,
          password,
          email_confirm: true,
        });
      if (callerAuthErr || !callerAuth.user) {
        throw new Error(`Failed to create caller user: ${callerAuthErr?.message}`);
      }
      callerUserId = callerAuth.user.id;

      const { data: ownerAuth, error: ownerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: ownerEmail,
          password,
          email_confirm: true,
        });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`Failed to create owner user: ${ownerAuthErr?.message}`);
      }
      ownerBUserId = ownerAuth.user.id;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F024 Doc Workspace A", slug: `f024-doc-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F024 Doc Workspace B", slug: `f024-doc-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      const { error: memberAErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: callerUserId,
        role: "member",
        status: "active",
      });
      if (memberAErr) throw new Error(`Failed to seed caller membership: ${memberAErr.message}`);

      const { error: memberBErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: ownerBUserId,
        role: "member",
        status: "active",
      });
      if (memberBErr) throw new Error(`Failed to seed owner membership: ${memberBErr.message}`);

      const { data: doc, error: docErr } = await adminClient
        .from("docs")
        .insert({
          workspace_id: workspaceBId,
          title: `F024 Private Doc ${uniqueSuffix}`,
          content: "This content must never leak across a workspace boundary.",
          created_by: ownerBUserId,
        })
        .select("id")
        .single();
      if (docErr || !doc) throw new Error(`Failed to seed foreign doc: ${docErr?.message}`);
      foreignDocId = doc.id;

      callerSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await callerSessionClient.auth.signInWithPassword({
        email: callerEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in caller: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (foreignDocId) await adminClient.from("docs").delete().eq("id", foreignDocId);
      for (const wsId of [workspaceAId, workspaceBId]) {
        if (wsId) {
          await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
          await adminClient.from("workspaces").delete().eq("id", wsId);
        }
      }
      if (callerUserId) await adminClient.auth.admin.deleteUser(callerUserId);
      if (ownerBUserId) await adminClient.auth.admin.deleteUser(ownerBUserId);
      // F031: belt-and-suspenders sweep for anything left behind by a
      // beforeAll that threw partway, or a prior run killed before its own
      // afterAll could execute.
      await sweepLeakedFixtures(adminClient, LEAK_PREFIXES);
    });

    it("AS-008: a caller in workspace A cannot read a real document that exists only in workspace B", async () => {
      const { run } = await import("@/lib/ai/tools/get-current-doc");

      const result = await run({ docId: foreignDocId }, workspaceAId);

      expect(result.status).toBe("empty");
      if (result.status === "empty") {
        expect(result.reason).toBe("not_found");
        expect(result.message).toBe("No matching document found.");
        expect(JSON.stringify(result)).not.toMatch(/f024 private doc/i);
        expect(JSON.stringify(result)).not.toMatch(/must never leak/i);
      }
    });
  },
);

// F027 (fixes M1-SCRUTINY.md M1c, AS-021): the case none of the tests
// above can reach — a caller who is an active member of BOTH workspace A
// and workspace B, calling with A as their current workspace, must get
// the exact same empty/not_found result for a document that genuinely
// exists in workspace B, even though RLS alone (which only proves "some
// active membership") would let the query through.
describe.skipIf(!shouldRunLiveDbTests)(
  "get_current_doc denies access to a document in a workspace the caller is ALSO an active member of, when it is not their current workspace (F027: AS-021)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let callerUserId: string;
    let foreignDocId: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const callerEmail = `f027-get-doc-both-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";

      const { data: callerAuth, error: callerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: callerEmail,
          password,
          email_confirm: true,
        });
      if (callerAuthErr || !callerAuth.user) {
        throw new Error(`Failed to create caller user: ${callerAuthErr?.message}`);
      }
      callerUserId = callerAuth.user.id;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Doc Workspace A", slug: `f027-doc-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Doc Workspace B", slug: `f027-doc-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      // Caller is an ACTIVE member of BOTH workspaces.
      const { error: memberAErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: callerUserId,
        role: "member",
        status: "active",
      });
      if (memberAErr) throw new Error(`Failed to seed workspace A membership: ${memberAErr.message}`);

      const { error: memberBErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: callerUserId,
        role: "member",
        status: "active",
      });
      if (memberBErr) throw new Error(`Failed to seed workspace B membership: ${memberBErr.message}`);

      const { data: doc, error: docErr } = await adminClient
        .from("docs")
        .insert({
          workspace_id: workspaceBId,
          title: `F027 Both-Member Doc ${uniqueSuffix}`,
          content: "This content must never leak into workspace A's view.",
          created_by: callerUserId,
        })
        .select("id")
        .single();
      if (docErr || !doc) throw new Error(`Failed to seed workspace B doc: ${docErr?.message}`);
      foreignDocId = doc.id;

      callerSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await callerSessionClient.auth.signInWithPassword({
        email: callerEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in caller: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (foreignDocId) await adminClient.from("docs").delete().eq("id", foreignDocId);
      for (const wsId of [workspaceAId, workspaceBId]) {
        if (wsId) {
          await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
          await adminClient.from("workspaces").delete().eq("id", wsId);
        }
      }
      if (callerUserId) await adminClient.auth.admin.deleteUser(callerUserId);
      // F031: belt-and-suspenders sweep for anything left behind by a
      // beforeAll that threw partway, or a prior run killed before its own
      // afterAll could execute.
      await sweepLeakedFixtures(adminClient, LEAK_PREFIXES);
    });

    it("AS-021: a real document in workspace B returns the identical not_found empty result when the caller's CURRENT workspace is A, even though the caller is also an active member of B", async () => {
      const { run } = await import("@/lib/ai/tools/get-current-doc");

      const result = await run({ docId: foreignDocId }, workspaceAId);

      expect(result).toEqual({
        status: "empty",
        reason: "not_found",
        message: "No matching document found.",
      });
      expect(JSON.stringify(result)).not.toMatch(/f027 both-member doc/i);
      expect(JSON.stringify(result)).not.toMatch(/must never leak/i);
    });
  },
);
