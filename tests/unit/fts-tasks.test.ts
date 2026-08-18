// Integration test for F068 (AS-117, AS-123, AS-124).
//
// Exercises the real Postgres full-text search setup added by
// supabase/migrations/20260818050200_fts_tasks.sql (generated, weighted
// `search_vector` tsvector column — title weighted 'A', description
// weighted 'B' — with a GIN index) and
// supabase/migrations/20260818050300_fts_tasks_search_fn.sql (the
// `search_tasks(p_project_id, p_query)` ranked-search RPC).
//
// Runs against the live linked Supabase project via the admin
// (service-role) client — the same client `lib/supabase/admin.ts` exposes
// to Server Actions — so this proves the behaviour end-to-end against real
// Postgres rather than mocking text-search internals.
//
//   AS-117: search matches against task title and description.
//   AS-123: search is case-insensitive — verified here with a real query
//     (searching "URGENT" finds a task titled "urgent fix"), not assumed.
//   AS-124: a term matching only the title ranks before a term matching
//     only the description, via ts_rank against the weighted
//     search_vector (exercised through the search_tasks RPC's ORDER BY).
//
// Skips itself (rather than failing) when Supabase env vars aren't
// present, so `npm run test` stays green in environments without DB
// access (e.g. a bare checkout before `.env` is populated).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const hasSupabaseEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;

const describeIfEnv = hasSupabaseEnv ? describe : describe.skip;

describeIfEnv("F068 full-text search (AS-117, AS-123, AS-124)", () => {
  const admin = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let userId: string;
  let workspaceId: string;
  let projectId: string;
  let titleTaskId: string;
  let descriptionTaskId: string;
  let caseTaskId: string;

  beforeAll(async () => {
    const { data: userRes, error: userErr } =
      await admin.auth.admin.createUser({
        email: `fts-test-${runId}@example.com`,
        email_confirm: true,
      });
    if (userErr || !userRes.user) {
      throw new Error(`failed to create test user: ${userErr?.message}`);
    }
    userId = userRes.user.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: `FTS Test WS ${runId}`, slug: `fts-test-${runId}` })
      .select("id")
      .single();
    if (wsErr || !workspace) {
      throw new Error(`failed to create workspace: ${wsErr?.message}`);
    }
    workspaceId = workspace.id;

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: `FTS Test Project ${runId}` })
      .select("id")
      .single();
    if (projErr || !project) {
      throw new Error(`failed to create project: ${projErr?.message}`);
    }
    projectId = project.id;

    // Title-only match: "urgentword" appears only in the title.
    const { data: titleTask, error: titleErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        author_id: userId,
        title: `Fixthingnow urgentword task ${runId}`,
        description: "nothing relevant here",
      })
      .select("id")
      .single();
    if (titleErr || !titleTask) {
      throw new Error(`failed to create title task: ${titleErr?.message}`);
    }
    titleTaskId = titleTask.id;

    // Description-only match: same "urgentword" term, but only in the
    // description — title is unrelated.
    const { data: descriptionTask, error: descErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        author_id: userId,
        title: `Unrelated task title ${runId}`,
        description: "this description mentions urgentword in passing",
      })
      .select("id")
      .single();
    if (descErr || !descriptionTask) {
      throw new Error(
        `failed to create description task: ${descErr?.message}`,
      );
    }
    descriptionTaskId = descriptionTask.id;

    // Case-insensitivity fixture: title stored lower-case, searched upper-case.
    const { data: caseTask, error: caseErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        author_id: userId,
        title: `urgent fix ${runId}`,
        description: null,
      })
      .select("id")
      .single();
    if (caseErr || !caseTask) {
      throw new Error(`failed to create case task: ${caseErr?.message}`);
    }
    caseTaskId = caseTask.id;
  });

  afterAll(async () => {
    if (projectId) {
      await admin.from("tasks").delete().eq("project_id", projectId);
      await admin.from("projects").delete().eq("id", projectId);
    }
    if (workspaceId) {
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("AS-117: search_vector matches a term present in either title or description", async () => {
    const { data, error } = await admin.rpc("search_tasks", {
      p_project_id: projectId,
      p_query: "urgentword",
    });

    expect(error).toBeNull();
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(titleTaskId);
    expect(ids).toContain(descriptionTaskId);
  });

  it("AS-123: search is case-insensitive — 'URGENT' finds a task titled 'urgent fix'", async () => {
    const { data, error } = await admin.rpc("search_tasks", {
      p_project_id: projectId,
      p_query: "URGENT",
    });

    expect(error).toBeNull();
    const matched = (data ?? []).find((row) => row.id === caseTaskId);
    expect(matched).toBeDefined();
    expect(matched?.title.toLowerCase()).toContain("urgent");
  });

  it("AS-124: a title-only match ranks before a description-only match", async () => {
    const { data, error } = await admin.rpc("search_tasks", {
      p_project_id: projectId,
      p_query: "urgentword",
    });

    expect(error).toBeNull();
    expect(data?.length).toBe(2);

    const ids = (data ?? []).map((row) => row.id);
    const titleRank = ids.indexOf(titleTaskId);
    const descriptionRank = ids.indexOf(descriptionTaskId);

    expect(titleRank).toBeGreaterThanOrEqual(0);
    expect(descriptionRank).toBeGreaterThanOrEqual(0);
    expect(titleRank).toBeLessThan(descriptionRank);
  });
});
