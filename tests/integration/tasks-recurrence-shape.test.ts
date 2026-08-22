// Integration test for F175 `tasks.recurrence` / `recurrence_parent_id` /
// `last_occurrence_at` schema (AS-314, AS-323).
//
// Verifies against the real linked Supabase project that:
//  - all four supported recurrence shapes (daily, weekly, monthly,
//    every_n_days) are accepted by the tasks_recurrence_shape CHECK
//    constraint (AS-314)
//  - an unsupported freq value is rejected by the constraint (AS-314
//    negative case)
//  - interval <= 0 and a missing interval are rejected (AS-314 negative
//    case)
//  - `until` round-trips faithfully both when present (an end date) and
//    when absent (no end date), proving the two cases from AS-323 are
//    unambiguously representable in storage — generation logic itself is
//    out of scope for this feature (belongs to F177/F178)
//  - recurrence_parent_id correctly self-references another task row and
//    last_occurrence_at stores a timestamp
//  - a NULL recurrence is a valid, day-one empty state
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment. Mirrors tests/integration/rls-task-watchers.test.ts (F163).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F175: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("tasks.recurrence schema (F175)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let projectId: string;
  let authorId: string;
  const taskIdsToClean: string[] = [];

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F175 recurrence workspace", slug: `f175-recurrence-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const ownerEmail = `f175-owner-${uniqueSuffix}@example.com`;
    const { data: ownerAuth, error: ownerAuthErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (ownerAuthErr || !ownerAuth.user) {
      throw new Error(`Failed to create owner test user: ${ownerAuthErr?.message}`);
    }
    authorId = ownerAuth.user.id;

    const { error: memberErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: authorId,
      role: "owner",
      status: "active",
    });
    if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

    const { data: project, error: projectErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F175 recurrence project" })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
    projectId = project.id;
  });

  afterAll(async () => {
    if (taskIdsToClean.length > 0) {
      await adminClient.from("tasks").delete().in("id", taskIdsToClean);
    }
    if (workspaceId) {
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  async function insertTask(recurrence: unknown, titleSuffix: string) {
    const { data, error } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: `F175 recurrence test — ${titleSuffix}`,
        author_id: authorId,
        recurrence: recurrence as never,
      })
      .select("id, recurrence")
      .single();
    if (data) taskIdsToClean.push(data.id);
    return { data, error };
  }

  it("AS-314: a null recurrence is a valid empty state", async () => {
    const { data, error } = await insertTask(null, "no recurrence");
    expect(error).toBeNull();
    expect(data?.recurrence).toBeNull();
  });

  it.each(["daily", "weekly", "monthly", "every_n_days"])(
    "AS-314: freq=%s with a positive interval is accepted",
    async (freq) => {
      const { data, error } = await insertTask({ freq, interval: 3 }, `freq-${freq}`);
      expect(error).toBeNull();
      expect(data?.recurrence).toEqual({ freq, interval: 3 });
    },
  );

  it("AS-314: an unsupported freq value is rejected by the CHECK constraint", async () => {
    const { data, error } = await insertTask(
      { freq: "yearly", interval: 1 },
      "unsupported freq",
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/tasks_recurrence_shape/);
  });

  it("AS-314: interval <= 0 is rejected by the CHECK constraint", async () => {
    const { data, error } = await insertTask(
      { freq: "daily", interval: 0 },
      "zero interval",
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/tasks_recurrence_shape/);
  });

  it("AS-314: a missing interval is rejected by the CHECK constraint", async () => {
    const { data, error } = await insertTask({ freq: "daily" }, "missing interval");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/tasks_recurrence_shape/);
  });

  it("AS-323: a recurrence with an explicit end date round-trips the `until` field faithfully", async () => {
    const { data, error } = await insertTask(
      { freq: "weekly", interval: 1, until: "2026-12-31" },
      "with end date",
    );
    expect(error).toBeNull();
    expect(data?.recurrence).toEqual({ freq: "weekly", interval: 1, until: "2026-12-31" });
  });

  it("AS-323: a recurrence with no `until` key unambiguously means no end date", async () => {
    const { data, error } = await insertTask(
      { freq: "monthly", interval: 1 },
      "no end date",
    );
    expect(error).toBeNull();
    expect(data?.recurrence).toEqual({ freq: "monthly", interval: 1 });
    expect((data?.recurrence as { until?: string })?.until).toBeUndefined();
  });

  it("AS-323: an invalid `until` date string is rejected on insert", async () => {
    // Postgres rejects the malformed date during the ::date cast inside the
    // CHECK expression itself (a database-level error, not a swallowed
    // constraint violation), so the insert still fails — just with
    // Postgres's native "invalid input syntax for type date" message rather
    // than a named constraint-violation message.
    const { data, error } = await insertTask(
      { freq: "daily", interval: 1, until: "not-a-date" },
      "invalid until",
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/invalid input syntax for type date/);
  });

  it("recurrence_parent_id links a generated occurrence back to its source task, and last_occurrence_at stores a timestamp", async () => {
    const { data: parent, error: parentErr } = await insertTask(
      { freq: "daily", interval: 1 },
      "parent",
    );
    expect(parentErr).toBeNull();
    expect(parent).not.toBeNull();

    const now = new Date().toISOString();
    const { data: occurrence, error: occurrenceErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F175 recurrence test — generated occurrence",
        author_id: authorId,
        recurrence_parent_id: parent!.id,
      })
      .select("id, recurrence_parent_id")
      .single();
    expect(occurrenceErr).toBeNull();
    expect(occurrence?.recurrence_parent_id).toBe(parent!.id);
    if (occurrence) taskIdsToClean.push(occurrence.id);

    const { data: updated, error: updateErr } = await adminClient
      .from("tasks")
      .update({ last_occurrence_at: now })
      .eq("id", parent!.id)
      .select("last_occurrence_at")
      .single();
    expect(updateErr).toBeNull();
    expect(updated?.last_occurrence_at).not.toBeNull();
  });
});
