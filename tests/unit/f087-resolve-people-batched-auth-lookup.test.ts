// Unit test for F087 (perf audit item 7): lib/queries/people.ts's
// resolvePeople() used to call `auth.admin.getUserById(id)` once PER id
// missing a `profiles.display_name`, inside a `Promise.all` -- N Admin
// API HTTP calls for N un-named users. Fixed by replacing that loop with
// a single `get_users_by_ids` RPC
// (supabase/migrations/20261027020000_f087_batch_get_users_by_ids.sql),
// keyed into a map before the per-id loop that builds the final
// `PersonSummary` map.
//
// Mocks `@/lib/supabase/admin` directly (resolvePeople's only external
// dependency) so this test can assert the call count/shape without a
// live project; behavioural end-to-end coverage of the name-resolution
// fallback chain itself is unchanged and still covered by
// tests/integration/update-profile.test.ts.

import { describe, expect, it, vi } from "vitest";

const PROFILE_ROWS: { id: string; display_name: string | null; avatar_url: string | null }[] = [
  { id: "user-with-name", display_name: "Ada Lovelace", avatar_url: null },
];

const AUTH_ROWS: { id: string; email: string; raw_user_meta_data: Record<string, unknown> }[] = [
  { id: "user-no-name-1", email: "a@example.com", raw_user_meta_data: {} },
  { id: "user-no-name-2", email: "b@example.com", raw_user_meta_data: { full_name: "Bea" } },
];

let getUserByIdCallCount = 0;
let rpcCalls: { name: string; args: unknown }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          in: async () => ({ data: PROFILE_ROWS, error: null }),
        }),
      };
    },
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "get_users_by_ids") {
        const ids = (args as { p_ids: string[] }).p_ids;
        return {
          data: AUTH_ROWS.filter((row) => ids.includes(row.id)),
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected rpc" } };
    }),
    auth: {
      admin: {
        getUserById: async () => {
          getUserByIdCallCount += 1;
          return { data: { user: null }, error: null };
        },
      },
    },
  })),
}));

import { resolvePeople } from "@/lib/queries/people";

describe("test_resolve_people_batches_the_auth_lookup_into_one_rpc", () => {
  it("issues exactly one get_users_by_ids RPC for two ids missing a display_name, never getUserById", async () => {
    getUserByIdCallCount = 0;
    rpcCalls = [];

    const result = await resolvePeople([
      "user-with-name",
      "user-no-name-1",
      "user-no-name-2",
    ]);

    expect(getUserByIdCallCount).toBe(0);
    const batchCalls = rpcCalls.filter((c) => c.name === "get_users_by_ids");
    expect(batchCalls).toHaveLength(1);
    expect((batchCalls[0]!.args as { p_ids: string[] }).p_ids.sort()).toEqual(
      ["user-no-name-1", "user-no-name-2"].sort(),
    );

    expect(result.get("user-with-name")).toEqual({
      name: "Ada Lovelace",
      email: null,
      avatarUrl: null,
    });
    expect(result.get("user-no-name-1")).toEqual({
      name: "a", // email local-part fallback (no display_name, no metadata name)
      email: "a@example.com",
      avatarUrl: null,
    });
    expect(result.get("user-no-name-2")).toEqual({
      name: "Bea", // user_metadata.full_name fallback
      email: "b@example.com",
      avatarUrl: null,
    });
  });

  it("skips the batched RPC entirely when every id already has a display_name", async () => {
    getUserByIdCallCount = 0;
    rpcCalls = [];

    await resolvePeople(["user-with-name"]);

    expect(rpcCalls.filter((c) => c.name === "get_users_by_ids")).toHaveLength(0);
    expect(getUserByIdCallCount).toBe(0);
  });

  it("returns an empty map without touching the network for an empty id list", async () => {
    rpcCalls = [];
    const result = await resolvePeople([]);
    expect(result.size).toBe(0);
    expect(rpcCalls).toHaveLength(0);
  });
});
