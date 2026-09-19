// F033 (missions/20260919-150607): drop architecture_node_meta.client_visible
// (confirmed 0 true rows by F031) and the "client" RLS policy that reads it
// (architecture_node_meta_select_client, added in
// 20261127021000_architecture_node_meta.sql -- no portal surface ever
// queried this table, so the policy had no readers).
//
// AS-115: the migration exists and was applied to the live database.
// AS-116: `client_visible` no longer appears in the NodeMeta type or the
//         query that loads it.
// AS-122: the client SELECT RLS policy on architecture_node_meta is gone.
//
// The live check (AS-115/122) piggybacks on a single fact: Postgres refuses
// `alter table ... drop column client_visible` while a policy still
// references that column in its USING clause, so a successful drop of the
// column is only possible if the policy was dropped first. Selecting the
// column and getting "column does not exist" (42703) is therefore proof
// both halves of the migration landed, not just the column half.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveCreds = Boolean(SUPABASE_URL && SECRET_KEY);

if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe("AS-115: the drop-client_visible migration exists in supabase/migrations", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) =>
    f.endsWith("_drop_node_meta_client_visible.sql"),
  );

  it("finds exactly one migration file for this feature", () => {
    expect(files.length).toBe(1);
  });

  it("the migration drops architecture_node_meta.client_visible", () => {
    const sql = readFileSync(join(migrationsDir, files[0]), "utf-8");
    expect(sql).toMatch(/drop\s+column\s+if\s+exists\s+client_visible/i);
    expect(sql).toMatch(/architecture_node_meta/i);
  });

  it("AS-122: the same migration drops the client select policy", () => {
    const sql = readFileSync(join(migrationsDir, files[0]), "utf-8");
    expect(sql).toMatch(
      /drop\s+policy\s+if\s+exists\s+architecture_node_meta_select_client/i,
    );
  });
});

describe("AS-116: client_visible is gone from the NodeMeta type and its query", () => {
  it("lib/architecture/types.ts no longer declares NodeMeta.clientVisible", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "architecture", "types.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/clientVisible\s*:/);
  });

  it("lib/queries/architecture-details.ts no longer selects or maps client_visible", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "queries", "architecture-details.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/client_visible/);
    expect(source).not.toMatch(/clientVisible/);
  });
});

describe.skipIf(!haveCreds)(
  "AS-115 / AS-122 (live): architecture_node_meta.client_visible and its policy no longer exist",
  () => {
    let admin: SupabaseClient;

    it("selecting client_visible from the live table fails with 'column does not exist'", async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error } = await admin
        .from("architecture_node_meta")
        .select("client_visible")
        .limit(1);

      expect(error).not.toBeNull();
      // PostgREST surfaces Postgres's undefined_column SQLSTATE as 42703.
      expect(error?.code).toBe("42703");
    });

    it("the table itself (and its remaining columns) are still queryable", async () => {
      const { error } = await admin
        .from("architecture_node_meta")
        .select("task_id, project_id, intent, copy_status")
        .limit(1);

      expect(error).toBeNull();
    });
  },
);
