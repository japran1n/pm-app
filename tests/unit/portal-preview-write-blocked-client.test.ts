// F024b (missions/20260903-portal, AS-052): Layer A of the default-deny
// write block -- lib/supabase/server.ts's createClient() wraps the
// impersonated preview client so that ANY `.from(table).insert/update/
// upsert/delete(...)` is refused unconditionally, structurally, before a
// future portal Server Action that forgets an explicit assertNotPreview()
// guard could ever reach a real write. This tests that seam directly,
// independent of any single action's own guard.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const ACCESS_TOKEN = "preview-access-token";
const REFRESH_TOKEN = "preview-refresh-token";

let setSessionCalls: unknown[];

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      setSession: async (args: unknown) => {
        setSessionCalls.push(args);
        return { data: {}, error: null };
      },
    },
    from: (table: string) => {
      const state: { table: string } = { table };
      const readBuilder = {
        select: () => readBuilder,
        eq: () => readBuilder,
        maybeSingle: async () => ({ data: { id: "row-1", table: state.table }, error: null }),
      };
      return {
        ...readBuilder,
        insert: (row: unknown) => ({
          select: () => ({
            single: async () => ({ data: row, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
        delete: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    },
    rpc: async (name: string) => ({ data: { rpc: name }, error: null }),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "portal_preview_access_token") return { value: ACCESS_TOKEN };
      if (name === "portal_preview_refresh_token") return { value: REFRESH_TOKEN };
      return undefined;
    },
    getAll: () => [],
    set: () => {},
  }),
}));

beforeEach(() => {
  vi.resetModules();
  setSessionCalls = [];
});

type QueryResult = { data: unknown; error: { message: string } | null };
// Mirrors the real runtime shape of both a genuine PostgREST builder chain
// AND `blockedPreviewWrite()`'s own thenable-and-infinitely-chainable proxy
// (lib/supabase/server.ts) -- every method returns another instance of the
// same type, and the whole thing is directly awaitable to a `QueryResult`.
type Chain = PromiseLike<QueryResult> & {
  [method: string]: (...args: unknown[]) => Chain;
};
type PreviewTestClient = {
  from: (table: string) => Chain;
};

async function asPreviewTestClient(client: unknown): Promise<PreviewTestClient> {
  return client as PreviewTestClient;
}

describe("createClient() preview write block (F024b, AS-052, Layer A)", () => {
  it("test_AS_052_insert_is_refused_under_a_preview_session", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const client = await asPreviewTestClient(supabase);
    const result = await client.from("client_requests").insert({ title: "x" });
    expect(result.error).toBeTruthy();
    expect(result.error?.message).toBe(
      "You're previewing as a client. Actions are disabled in preview.",
    );
    expect(result.data).toBeNull();
  });

  it("test_AS_052_update_is_refused_under_a_preview_session", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const client = await asPreviewTestClient(supabase);
    const result = await client.from("tasks").update({ done: true }).eq("id", "1");
    expect(result.error?.message).toBe(
      "You're previewing as a client. Actions are disabled in preview.",
    );
  });

  it("test_AS_052_upsert_is_refused_under_a_preview_session", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const client = await asPreviewTestClient(supabase);
    const result = await client.from("tasks").upsert({ id: "1" }).select().single();
    expect(result.error?.message).toBe(
      "You're previewing as a client. Actions are disabled in preview.",
    );
  });

  it("test_AS_052_delete_is_refused_under_a_preview_session", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const client = await asPreviewTestClient(supabase);
    const result = await client.from("client_requests").delete().eq("id", "1");
    expect(result.error?.message).toBe(
      "You're previewing as a client. Actions are disabled in preview.",
    );
  });

  it("test_AS_052_reads_are_unaffected_by_the_preview_write_block", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const client = await asPreviewTestClient(supabase);
    const result = await client.from("tasks").select("id").eq("id", "1").maybeSingle();
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "row-1", table: "tasks" });
  });

  it("test_AS_052_the_impersonated_session_is_still_set_from_the_preview_cookies", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();
    expect(setSessionCalls).toEqual([
      { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN },
    ]);
  });
});

describe("isPortalPreview() (F024b)", () => {
  it("test_AS_052_isPortalPreview_is_true_when_both_preview_cookies_are_present", async () => {
    const { isPortalPreview } = await import("@/lib/supabase/server");
    expect(await isPortalPreview()).toBe(true);
  });
});
