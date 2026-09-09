// Integration test for F004/F024 (AS-023), run against the real linked
// Supabase project — mirrors the pattern established by
// tests/integration/palette-search-private-project-leak.test.ts.
//
// M1-SCRUTINY.md B2: the mocked unit test
// `test_AS_023_AS_008_doc_in_another_workspace_never_appears`
// (lib/ai/tools/__tests__/search-docs.test.ts) simulated the workspace
// boundary by simply never putting a foreign-workspace row into its own
// mock result set, then asserted the serialized output doesn't contain a
// string ("foreign"/"other-workspace") the test itself never wrote into
// that mock either — it would pass identically if RLS were dropped
// entirely or the tool used a service-role client. This test proves the
// real property end-to-end: a real user who is an active member of
// workspace A, searching for a token that exists ONLY inside a real
// document in workspace B (which they are not a member of), gets zero
// results for that token — an actual RLS denial, not a filtered mock.

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
  "search_docs excludes documents from a workspace the caller is not a member of (F024: AS-023)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let callerUserId: string;
    let ownerBUserId: string;
    let foreignDocId: string;
    let uniqueToken: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueToken = `zzsd${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;
      const callerEmail = `f024-search-docs-caller-${uniqueSuffix}@example.com`;
      const ownerEmail = `f024-search-docs-owner-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F024 Search Workspace A", slug: `f024-search-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F024 Search Workspace B", slug: `f024-search-b-${uniqueSuffix}` })
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
          title: `F024 Search Doc ${uniqueToken}`,
          content: `This body contains the unique token ${uniqueToken} exactly once.`,
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

    it("AS-023: searching a token that exists only inside a document in a workspace the caller cannot see returns no results", async () => {
      const { run } = await import("@/lib/ai/tools/search-docs");

      const result = await run({ query: uniqueToken }, workspaceAId);

      expect(result.status).toBe("empty");
      if (result.status === "empty") {
        expect(result.reason).toBe("no_results");
      }
    });
  },
);

// F029 (closes the B2 remainder, positive control): every describe above
// only ever asserts `status === "empty"` — a mutant that always filters to
// the nil workspace uuid, or a `forRunner` that drops `workspaceId` (making
// the eq() cast fail), passes every one of those green. This block proves
// the tool actually returns data: a real, unique token that exists ONLY in
// a document in the caller's OWN current workspace must come back `status
// === "ok"` with that document's id, title, and a snippet containing the
// token.
describe.skipIf(!shouldRunLiveDbTests)(
  "search_docs finds a real document in the caller's own current workspace (F029: AS-022, AS-028)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let callerUserId: string;
    let ownDocId: string;
    let uniqueToken: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueToken = `zzsdown${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;
      const callerEmail = `f024-search-docs-own-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F024 Search Own Workspace A", slug: `f024-search-own-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { error: memberAErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: callerUserId,
        role: "member",
        status: "active",
      });
      if (memberAErr) throw new Error(`Failed to seed caller membership: ${memberAErr.message}`);

      const { data: doc, error: docErr } = await adminClient
        .from("docs")
        .insert({
          workspace_id: workspaceAId,
          title: `F024 Own Search Doc ${uniqueToken}`,
          content: `This body contains the unique token ${uniqueToken} exactly once.`,
          created_by: callerUserId,
        })
        .select("id")
        .single();
      if (docErr || !doc) throw new Error(`Failed to seed own doc: ${docErr?.message}`);
      ownDocId = doc.id;

      callerSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await callerSessionClient.auth.signInWithPassword({
        email: callerEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in caller: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (ownDocId) await adminClient.from("docs").delete().eq("id", ownDocId);
      if (workspaceAId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceAId);
        await adminClient.from("workspaces").delete().eq("id", workspaceAId);
      }
      if (callerUserId) await adminClient.auth.admin.deleteUser(callerUserId);
      // F031: belt-and-suspenders sweep for anything left behind by a
      // beforeAll that threw partway, or a prior run killed before its own
      // afterAll could execute.
      await sweepLeakedFixtures(adminClient, LEAK_PREFIXES);
    });

    it("AS-022/AS-028: a real doc in the caller's own current workspace comes back status 'ok' with matching id, title, and snippet", async () => {
      const { run } = await import("@/lib/ai/tools/search-docs");

      const result = await run({ query: uniqueToken }, workspaceAId);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.results.length).toBeGreaterThan(0);
        expect(result.data.results.length).toBeLessThanOrEqual(10);
        const match = result.data.results.find((r) => r.docId === ownDocId);
        expect(match).toBeDefined();
        expect(match?.title).toBe(`F024 Own Search Doc ${uniqueToken}`);
        expect(match?.snippet).toContain(uniqueToken);
      }
    });
  },
);

// F027 (fixes M1-SCRUTINY.md M1c): the case none of the tests above can
// reach. RLS (`docs_select_active_members`) only proves the caller is an
// active member of SOME workspace containing the doc — it says nothing
// about which workspace is their CURRENT one. A caller who is an active
// member of BOTH workspace A and workspace B, calling with A as their
// current workspace, must not see B's document even though RLS alone
// would let them (they really are an active member of B too). This is
// the property AS-023 ("restricts results to the caller's current
// workspace") actually asserts, and the only test that can prove it.
describe.skipIf(!shouldRunLiveDbTests)(
  "search_docs excludes a document from a workspace the caller is ALSO an active member of, when it is not their current workspace (F027: AS-023)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let callerUserId: string;
    let foreignDocId: string;
    let uniqueToken: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueToken = `zzsdboth${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;
      const callerEmail = `f027-search-docs-both-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F027 Search Workspace A", slug: `f027-search-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Search Workspace B", slug: `f027-search-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      // Caller is an ACTIVE member of BOTH workspaces — this is the case
      // RLS alone cannot distinguish from a single-workspace caller.
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
          title: `F027 Search Doc ${uniqueToken}`,
          content: `This body contains the unique token ${uniqueToken} exactly once.`,
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

    it("AS-023: a token that exists only in workspace B's doc returns no results when the caller's CURRENT workspace is A, even though the caller is also an active member of B", async () => {
      const { run } = await import("@/lib/ai/tools/search-docs");

      const result = await run({ query: uniqueToken }, workspaceAId);

      expect(result.status).toBe("empty");
      if (result.status === "empty") {
        expect(result.reason).toBe("no_results");
      }
    });
  },
);
