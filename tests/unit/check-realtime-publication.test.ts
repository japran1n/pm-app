// F002: unit tests for the realtime publication health verifier. No test in
// this file hits the live Supabase project — discovery is exercised over
// fixture source strings, and the comparison logic is exercised in isolation.
import { describe, expect, it } from "vitest";

import {
  extractSubscribedTables,
  findUnpublishedTables,
  checkRealtimePublication,
} from "../../scripts/check-realtime-publication.mjs";

describe("extractSubscribedTables (pure logic)", () => {
  it("extracts the table from a single-line postgres_changes binding", () => {
    const source = `
      supabase.channel("x").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, cb).subscribe();
    `;
    expect(extractSubscribedTables(source)).toEqual(["tasks"]);
  });

  it("extracts the table from a multi-line binding with table on its own line", () => {
    const source = `
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "task_assignees",
            filter: \`task_id=eq.\${taskId}\`,
          },
          (payload) => dispatch(payload),
        )
        .subscribe();
    `;
    expect(extractSubscribedTables(source)).toEqual(["task_assignees"]);
  });

  it("extracts multiple distinct bindings from the same file", () => {
    const source = `
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comment_reactions", filter: "task_id=eq.1" }, a)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "comment_reactions", filter: "task_id=eq.1" }, b)
    `;
    expect(extractSubscribedTables(source)).toEqual(["comment_reactions", "comment_reactions"]);
  });

  it("returns an empty array when there is no postgres_changes binding", () => {
    const source = `const x = { table: "not_a_subscription" };`;
    expect(extractSubscribedTables(source)).toEqual([]);
  });
});

describe("findUnpublishedTables (pure logic)", () => {
  it("returns no missing tables when every subscribed table is published", () => {
    expect(findUnpublishedTables(["tasks", "comments"], ["tasks", "comments", "channels"])).toEqual([]);
  });

  it("names a subscribed-but-unpublished table", () => {
    const missing = findUnpublishedTables(["tasks", "client_requests"], ["tasks", "comments"]);
    expect(missing).toEqual(["client_requests"]);
  });
});

describe("checkRealtimePublication (end-to-end over injected fakes)", () => {
  it("returns a non-zero code naming a subscribed table absent from the publication", async () => {
    const result = await checkRealtimePublication({
      accessToken: "fake-token",
      projectRef: "fake-ref",
      discover: () => ["tasks", "client_requests"],
      queryPublished: async () => ["tasks", "comments"],
    });
    expect(result.code).not.toBe(0);
    expect(result.isError).toBe(true);
    expect(result.message).toContain("client_requests");
  });

  it("returns 0 when every subscribed table is published", async () => {
    const result = await checkRealtimePublication({
      accessToken: "fake-token",
      projectRef: "fake-ref",
      discover: () => ["tasks", "comments"],
      queryPublished: async () => ["tasks", "comments", "channels"],
    });
    expect(result.code).toBe(0);
    expect(result.isError).toBe(false);
  });

  it("exits 1 with a plain message (not a stack trace) when credentials are missing", async () => {
    const result = await checkRealtimePublication({
      accessToken: undefined,
      projectRef: undefined,
    });
    expect(result.code).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.message).toBe("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env");
  });
});
