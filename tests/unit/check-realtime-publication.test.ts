// F002: unit tests for the realtime publication health verifier. No test in
// this file hits the live Supabase project — discovery is exercised over
// fixture source strings, and the comparison logic is exercised in isolation.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractSubscribedTables,
  findUnpublishedTables,
  checkRealtimePublication,
  discoverSubscribedTables,
  redactSecrets,
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

describe("AS-006: discoverSubscribedTables is genuinely source-derived", () => {
  it("finds the real postgres_changes bindings across the actual components/ and lib/ trees", () => {
    const discovered = discoverSubscribedTables();

    // These tables are known (as of this feature) to be bound via
    // postgres_changes somewhere in components/ or lib/. A hardcoded-array
    // stand-in for discoverSubscribedTables would still return *some*
    // array, so this test also cross-checks the count against an
    // independent grep-style scan of the same trees below.
    const expectedSubset = [
      "tasks",
      "task_assignees",
      "comments",
      "comment_reactions",
      "messages",
      "message_reactions",
      "notifications",
      "project_statuses",
      "client_requests",
    ];
    for (const table of expectedSubset) {
      expect(discovered).toContain(table);
    }
    expect(discovered).toEqual([...discovered].sort());
  });

  it("matches an independently-derived set of postgres_changes table names in the real tree", () => {
    // Independent derivation: walk components/ and lib/ ourselves (via
    // Node fs, not the script's walkSourceFiles) and find `table: "<name>"`
    // occurrences that sit within 500 characters after a `postgres_changes`
    // literal, using a hand-rolled scan (indexOf-based, not the script's
    // own regex-based extractSubscribedTables/discoverSubscribedTables).
    // The resulting set is compared directly, by exact equality, against
    // discoverSubscribedTables()'s actual return value — so a hardcoded
    // array stand-in (e.g. a fixed 9-element literal baked into the
    // function body) fails this test unless it happens to exactly equal
    // what is really in the tree today, and any future drift between the
    // real source and either scan is caught immediately.
    function walk(dir: string): string[] {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return [];
      }
      const files: string[] = [];
      for (const entry of entries) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) {
          files.push(...walk(full));
        } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
          files.push(full);
        }
      }
      return files;
    }

    const independentlyDerivedTables = new Set<string>();
    for (const dir of ["components", "lib"]) {
      for (const file of walk(dir)) {
        const source = readFileSync(file, "utf8");
        let searchFrom = 0;
        let idx: number;
        while ((idx = source.indexOf("postgres_changes", searchFrom)) !== -1) {
          const window = source.slice(idx, idx + 500);
          const tableMatch = window.match(/table\s*:\s*["'`]([A-Za-z0-9_]+)["'`]/);
          if (tableMatch) independentlyDerivedTables.add(tableMatch[1]);
          searchFrom = idx + "postgres_changes".length;
        }
      }
    }

    expect(independentlyDerivedTables.size).toBeGreaterThan(0);

    const discovered = discoverSubscribedTables();
    expect(new Set(discovered)).toEqual(independentlyDerivedTables);
    expect(discovered).toEqual([...discovered].sort());
  });

  it("a hardcoded stand-in for discoverSubscribedTables would be caught: real discovery is not an arbitrary fixed array", () => {
    const hardcoded = ["tasks", "comments"];
    const discovered = discoverSubscribedTables();
    expect(discovered).not.toEqual(hardcoded);
  });

  it("discovers a table that exists nowhere in the current component/lib tree, proving discovery is actually derived from the scanned files rather than a baked-in literal", () => {
    // This is the test that specifically kills a "replace the function body
    // with the 9 tables that happen to be correct today" mutant: a
    // hardcoded literal cannot possibly know about a table name that is
    // invented fresh in a throwaway fixture directory at test time, no
    // matter how faithfully it matches the real tree's current contents.
    const tmpDir = mkdtempSync(join(tmpdir(), "realtime-discovery-test-"));
    try {
      const novelTable = "zzz_test_only_dynamic_table_never_hardcoded";
      writeFileSync(
        join(tmpDir, "fixture.ts"),
        `supabase.channel("x").on("postgres_changes", { event: "*", schema: "public", table: "${novelTable}" }, cb).subscribe();`,
      );

      const discovered = discoverSubscribedTables({ dirs: [tmpDir] });

      expect(discovered).toEqual([novelTable]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence of a given secret value", () => {
    const text = "error: token sbp_secret123 rejected (sbp_secret123)";
    const redacted = redactSecrets(text, ["sbp_secret123"]);
    expect(redacted).not.toContain("sbp_secret123");
    expect(redacted.split("[REDACTED]")).toHaveLength(3);
  });
});

describe("checkRealtimePublication (end-to-end over injected fakes)", () => {
  it("AS-003: redacts a credential value echoed into a non-JSON/error API response", async () => {
    const secretToken = "sbp_super-secret-token-value";
    const result = await checkRealtimePublication({
      accessToken: secretToken,
      projectRef: "fake-ref",
      discover: () => ["tasks"],
      queryPublished: async () => {
        throw new Error(`Unauthorized: bad token ${secretToken}`);
      },
    });
    expect(result.code).not.toBe(0);
    expect(result.message).not.toContain(secretToken);
    expect(result.message).toContain("[REDACTED]");
  });

  it("AS-003: redacts a SUPABASE_SECRET_KEY value echoed into a query-failure message, even though it is never passed as accessToken/projectRef", async () => {
    // Regression test for scrutiny-4 finding (1): the old local redactor
    // here only knew about [accessToken, projectRef] and let a
    // SUPABASE_SECRET_KEY value planted in process.env leak straight
    // through, unlike the drift script's env-keyed redactor. It has since
    // been unified with scripts/lib/redact-secrets.mjs. This must FAIL
    // against the pre-fix code (array-based redactor scoped to
    // accessToken/projectRef only).
    const leakedSecretKey = "sb_secret_LEAKED_VALUE_123";
    const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = leakedSecretKey;
    try {
      const result = await checkRealtimePublication({
        accessToken: "unrelated-access-token",
        projectRef: "fake-ref",
        discover: () => ["tasks"],
        queryPublished: async () => {
          throw new Error(`db error: password=${leakedSecretKey} rejected`);
        },
      });
      expect(result.code).not.toBe(0);
      expect(result.message).not.toContain(leakedSecretKey);
      expect(result.message).toContain("[REDACTED]");
    } finally {
      if (originalSecretKey === undefined) {
        delete process.env.SUPABASE_SECRET_KEY;
      } else {
        process.env.SUPABASE_SECRET_KEY = originalSecretKey;
      }
    }
  });

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
    // Explicit falsy strings, not `undefined` — the guard's default
    // parameters (`accessToken = ACCESS_TOKEN`) fall back to the real
    // process.env values on `undefined`, which now exist in CI. An empty
    // string is a real override that still fails the `!accessToken` check.
    const result = await checkRealtimePublication({
      accessToken: "",
      projectRef: "",
    });
    expect(result.code).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.message).toBe("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env");
  });
});
