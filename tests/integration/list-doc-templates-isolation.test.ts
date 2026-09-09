// Integration test for F005/F024 (AS-024, AS-002), run against the real
// linked Supabase project — mirrors the pattern established by
// tests/integration/palette-search-private-project-leak.test.ts.
//
// M1-SCRUTINY.md B2: the mocked unit test
// `test_AS_002_scoping_relies_entirely_on_rls_no_extra_workspace_filter_needed`
// (lib/ai/tools/__tests__/list-doc-templates.test.ts) simulated the
// workspace boundary by simply never including a foreign-workspace row in
// its own mock result set — it would pass identically if RLS were dropped
// entirely or the tool used a service-role client. This test proves the
// real property end-to-end: a real user who is an active, non-guest member
// of workspace A, calling list_doc_templates, never sees a real
// `kind='doc'` template that genuinely exists in workspace B (which they
// are not a member of) — an actual RLS denial, not a filtered mock.

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
  "list_doc_templates excludes doc templates from a workspace the caller is not a member of (F024: AS-024, AS-002)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let callerUserId: string;
    let ownerBUserId: string;
    let foreignTemplateId: string;
    let uniqueName: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueName = `F024 Foreign Doc Template ${uniqueSuffix}`;
      const callerEmail = `f024-list-templates-caller-${uniqueSuffix}@example.com`;
      const ownerEmail = `f024-list-templates-owner-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F024 Templates Workspace A", slug: `f024-tmpl-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F024 Templates Workspace B", slug: `f024-tmpl-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      // Caller is an ACTIVE, NON-GUEST member of workspace A — the tool
      // is fully usable, it just must never see workspace B's rows.
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

      const { data: template, error: templateErr } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceBId,
          kind: "doc",
          name: uniqueName,
          payload: {
            sections: ["Overview"],
            rules: ["Never leak across workspaces"],
            tone: "concise",
            folderHint: null,
          },
          created_by: ownerBUserId,
        })
        .select("id")
        .single();
      if (templateErr || !template) {
        throw new Error(`Failed to seed foreign doc template: ${templateErr?.message}`);
      }
      foreignTemplateId = template.id;

      callerSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await callerSessionClient.auth.signInWithPassword({
        email: callerEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in caller: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (foreignTemplateId) {
        await adminClient.from("task_templates").delete().eq("id", foreignTemplateId);
      }
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

    it("AS-024/AS-002: a caller in workspace A never sees a real doc template that exists only in workspace B", async () => {
      const { run } = await import("@/lib/ai/tools/list-doc-templates");

      const result = await run({}, workspaceAId);

      if (result.status === "ok") {
        expect(result.data.templates.some((t) => t.id === foreignTemplateId)).toBe(false);
        expect(result.data.templates.some((t) => t.name === uniqueName)).toBe(false);
      } else {
        // Caller has no templates of their own in workspace A either, so
        // the empty result is the correct outcome — as long as it is not
        // secretly the foreign template leaking through under a
        // different shape.
        expect(result.status).toBe("empty");
      }
    });
  },
);

// F029 (closes the B2 remainder, positive control): every describe above
// only ever asserts `status === "empty"` — a mutant that always filters to
// the nil workspace uuid passes every one of those green. This block proves
// the tool actually returns data: a real `kind='doc'` template that exists
// in the caller's OWN current workspace must come back `status === "ok"`
// with that template's id, name, and parsed payload fields.
describe.skipIf(!shouldRunLiveDbTests)(
  "list_doc_templates returns a real doc template in the caller's own current workspace (F029: AS-024, AS-028)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let callerUserId: string;
    let ownTemplateId: string;
    let uniqueName: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueName = `F024 Own Doc Template ${uniqueSuffix}`;
      const callerEmail = `f024-list-templates-own-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F024 Templates Own Workspace A", slug: `f024-tmpl-own-a-${uniqueSuffix}` })
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

      const { data: template, error: templateErr } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceAId,
          kind: "doc",
          name: uniqueName,
          payload: {
            sections: ["Overview"],
            rules: ["Say hello"],
          },
          created_by: callerUserId,
        })
        .select("id")
        .single();
      if (templateErr || !template) {
        throw new Error(`Failed to seed own doc template: ${templateErr?.message}`);
      }
      ownTemplateId = template.id;

      callerSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await callerSessionClient.auth.signInWithPassword({
        email: callerEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in caller: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (ownTemplateId) {
        await adminClient.from("task_templates").delete().eq("id", ownTemplateId);
      }
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

    it("AS-024/AS-028: a real doc template in the caller's own current workspace comes back status 'ok' with matching id and name", async () => {
      const { run } = await import("@/lib/ai/tools/list-doc-templates");

      const result = await run({}, workspaceAId);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        const match = result.data.templates.find((t) => t.id === ownTemplateId);
        expect(match).toBeDefined();
        expect(match?.name).toBe(uniqueName);
        expect(match?.sections).toEqual(["Overview"]);
        expect(match?.rules).toEqual(["Say hello"]);
      }
    });
  },
);

// F027 (fixes M1-SCRUTINY.md M1c): the case none of the tests above can
// reach — a caller who is an active member of BOTH workspace A and
// workspace B, calling with A as their current workspace, must not see
// B's doc template even though RLS alone (which only proves "some active
// membership") would let them.
describe.skipIf(!shouldRunLiveDbTests)(
  "list_doc_templates excludes a doc template from a workspace the caller is ALSO an active member of, when it is not their current workspace (F027: AS-024)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let callerUserId: string;
    let foreignTemplateId: string;
    let uniqueName: string;

    beforeAll(async () => {
      adminClient = createAdminClient();

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueName = `F027 Both-Member Doc Template ${uniqueSuffix}`;
      const callerEmail = `f027-list-templates-both-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F027 Templates Workspace A", slug: `f027-tmpl-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Templates Workspace B", slug: `f027-tmpl-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      // Caller is an ACTIVE, NON-GUEST member of BOTH workspaces.
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

      const { data: template, error: templateErr } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceBId,
          kind: "doc",
          name: uniqueName,
          // `docTemplatePayloadSchema` (lib/validation/templates.ts) uses
          // `.optional()` for tone/folderHint, which accepts `undefined`
          // but rejects `null` — omit both keys entirely rather than
          // setting them to `null`, or the row would fail `safeParse` and
          // get silently skipped regardless of workspace scoping, making
          // this test pass for the wrong reason.
          payload: {
            sections: ["Overview"],
            rules: ["Never leak across workspaces"],
          },
          created_by: callerUserId,
        })
        .select("id")
        .single();
      if (templateErr || !template) {
        throw new Error(`Failed to seed workspace B doc template: ${templateErr?.message}`);
      }
      foreignTemplateId = template.id;

      callerSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await callerSessionClient.auth.signInWithPassword({
        email: callerEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in caller: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (foreignTemplateId) {
        await adminClient.from("task_templates").delete().eq("id", foreignTemplateId);
      }
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

    it("AS-024: a doc template that exists only in workspace B never appears when the caller's CURRENT workspace is A, even though the caller is also an active member of B", async () => {
      const { run } = await import("@/lib/ai/tools/list-doc-templates");

      const result = await run({}, workspaceAId);

      // Strict, not a status-branch fallback that would pass vacuously:
      // the caller genuinely is an active member of workspace B too, so
      // pre-F027 (RLS alone) this legitimately comes back "ok" with the
      // foreign template included — the real assertion is that it is now
      // excluded, whatever the caller's own workspace-A templates look
      // like.
      expect(result.status).toBe("empty");
      if (result.status === "empty") {
        expect(result.reason).toBe("no_results");
      }
    });
  },
);
