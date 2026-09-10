// Integration test for F046: RLS across the four brief tables (briefs,
// brief_questions, brief_answers, brief_answer_revisions). Covers
// AS-157, AS-158, AS-159, AS-160, AS-161.
//
// Driven through real signed-in sessions and PostgREST, matching this
// suite's existing convention (tests/integration/portal-phases-rls.test.ts) —
// the point is exercising the RLS policies themselves.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";
const RLS_DENIED = "42501";

describe.skipIf(!haveCreds)("brief tables — RLS (F046)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient; // client of projectA (portal enabled)
  let outsiderClientSession: SupabaseClient; // client of an unrelated project
  let memberSession: SupabaseClient; // workspace writer (member role)
  let viewerSession: SupabaseClient; // viewer role, active member of projectA

  let workspaceId: string;
  let outsiderWorkspaceId: string;
  let projectAId: string; // portal enabled
  let projectDisabledId: string; // portal disabled
  let outsiderProjectId: string; // client is a member here, not of projectA

  let ownerId: string;
  let memberId: string;
  let clientId: string;
  let viewerId: string;
  let outsiderClientId: string;

  let briefAId: string;
  let briefDisabledId: string;
  let questionAId: string;
  let questionDisabledId: string;
  let answerAId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f046-brief-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientUser = await makeUser("client");
    const viewerUser = await makeUser("viewer");
    const outsiderClientUser = await makeUser("outsider-client");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;
    viewerId = viewerUser.id;
    outsiderClientId = outsiderClientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F046 brief RLS test", slug: `f046-brief-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    const { data: outsiderWorkspace, error: owsErr } = await admin
      .from("workspaces")
      .insert({ name: "F046 outsider workspace", slug: `f046-outsider-${suffix}` })
      .select("id")
      .single();
    if (owsErr || !outsiderWorkspace) throw new Error(`outsider workspace: ${owsErr?.message}`);
    outsiderWorkspaceId = outsiderWorkspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
      { workspace_id: outsiderWorkspaceId, user_id: outsiderClientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string, portalEnabled: boolean, wsId: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: wsId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: portalEnabled,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectAId = await insertProject("Project A (portal on)", true, workspaceId);
    projectDisabledId = await insertProject("Project disabled (portal off)", false, workspaceId);
    outsiderProjectId = await insertProject("Outsider project", true, outsiderWorkspaceId);

    await admin.from("project_members").insert([
      { project_id: projectAId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectAId, user_id: viewerId, project_role: "member", added_by: ownerId },
      { project_id: projectDisabledId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectDisabledId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: outsiderProjectId, user_id: outsiderClientId, project_role: "member", added_by: ownerId },
    ]);

    const insertBrief = async (projectId: string) => {
      const { data, error } = await admin
        .from("briefs")
        .insert({ project_id: projectId, state: "draft" })
        .select("id")
        .single();
      if (error || !data) throw new Error(`brief: ${error?.message}`);
      return data.id as string;
    };
    briefAId = await insertBrief(projectAId);
    briefDisabledId = await insertBrief(projectDisabledId);

    const insertQuestion = async (projectId: string, prompt: string) => {
      const { data, error } = await admin
        .from("brief_questions")
        .insert({ project_id: projectId, prompt, answer_type: "short_text" })
        .select("id")
        .single();
      if (error || !data) throw new Error(`question: ${error?.message}`);
      return data.id as string;
    };
    questionAId = await insertQuestion(projectAId, "What is your goal?");
    questionDisabledId = await insertQuestion(projectDisabledId, "Disabled project question");

    const { data: answer, error: answerErr } = await admin
      .from("brief_answers")
      .insert({
        brief_id: briefAId,
        question_id: questionAId,
        question_prompt_snapshot: "What is your goal?",
        answer_text: "Original answer",
      })
      .select("id")
      .single();
    if (answerErr || !answer) throw new Error(`answer: ${answerErr?.message}`);
    answerAId = answer.id;

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
    outsiderClientSession = await signIn(outsiderClientUser.email);
    memberSession = await signIn(memberUser.email);
    viewerSession = await signIn(viewerUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("brief_answers").delete().in("brief_id", [briefAId, briefDisabledId]);
    await admin.from("brief_questions").delete().in("project_id", [projectAId, projectDisabledId]);
    await admin.from("briefs").delete().in("id", [briefAId, briefDisabledId]);
    await admin
      .from("project_members")
      .delete()
      .in("project_id", [projectAId, projectDisabledId, outsiderProjectId]);
    await admin.from("projects").delete().in("id", [projectAId, projectDisabledId, outsiderProjectId]);
    await admin.from("workspace_members").delete().in("workspace_id", [workspaceId, outsiderWorkspaceId]);
    await admin.from("workspaces").delete().in("id", [workspaceId, outsiderWorkspaceId]);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // --- AS-157: a client cannot create, edit, or delete a question -------

  it("AS-157: a client cannot INSERT a brief_question", async () => {
    const { error } = await clientSession
      .from("brief_questions")
      .insert({ project_id: projectAId, prompt: "Client-injected question", answer_type: "short_text" });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("AS-157: a client cannot UPDATE a brief_question", async () => {
    const { error, count } = await clientSession
      .from("brief_questions")
      .update({ prompt: "Tampered" }, { count: "exact" })
      .eq("id", questionAId);
    // RLS on UPDATE with no matching policy denies the write; either an
    // explicit RLS error or zero rows affected proves nothing changed.
    if (error) {
      expect(error.code).toBe(RLS_DENIED);
    } else {
      expect(count).toBe(0);
    }
    const { data: check } = await admin.from("brief_questions").select("prompt").eq("id", questionAId).single();
    expect(check?.prompt).toBe("What is your goal?");
  });

  it("AS-157: a client cannot DELETE a brief_question", async () => {
    const { error, count } = await clientSession
      .from("brief_questions")
      .delete({ count: "exact" })
      .eq("id", questionAId);
    if (error) {
      expect(error.code).toBe(RLS_DENIED);
    } else {
      expect(count).toBe(0);
    }
    const { data: check } = await admin.from("brief_questions").select("id").eq("id", questionAId);
    expect(check).toHaveLength(1);
  });

  // --- AS-161: a viewer-role team member cannot edit questions ----------

  it("AS-161: a viewer-role team member cannot INSERT a brief_question", async () => {
    const { error } = await viewerSession
      .from("brief_questions")
      .insert({ project_id: projectAId, prompt: "Viewer-injected question", answer_type: "short_text" });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("AS-161: a viewer-role team member cannot UPDATE a brief_question", async () => {
    const { error, count } = await viewerSession
      .from("brief_questions")
      .update({ prompt: "Viewer tampered" }, { count: "exact" })
      .eq("id", questionAId);
    if (error) {
      expect(error.code).toBe(RLS_DENIED);
    } else {
      expect(count).toBe(0);
    }
  });

  it("regression: a non-viewer, non-client team member CAN create and update a brief_question", async () => {
    const { data: created, error: createError } = await memberSession
      .from("brief_questions")
      .insert({ project_id: projectAId, prompt: "Team-created question", answer_type: "short_text" })
      .select("id")
      .single();
    expect(createError).toBeNull();

    const { error: updateError } = await memberSession
      .from("brief_questions")
      .update({ prompt: "Team-updated question" })
      .eq("id", created!.id);
    expect(updateError).toBeNull();

    await admin.from("brief_questions").delete().eq("id", created!.id);
  });

  // --- AS-158: a client cannot read questions of a project they are not
  // a member of ----------------------------------------------------------

  it("AS-158: a client of projectA can select its own project's questions", async () => {
    const { data, error } = await clientSession
      .from("brief_questions")
      .select("id")
      .eq("id", questionAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("AS-158: a client who is not a member of projectA cannot select its questions", async () => {
    const { data, error } = await outsiderClientSession
      .from("brief_questions")
      .select("id")
      .eq("id", questionAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // --- AS-159: a client cannot read answers of a project they are not a
  // member of --------------------------------------------------------------

  it("AS-159: a client of projectA can select its own project's answers", async () => {
    const { data, error } = await clientSession
      .from("brief_answers")
      .select("id")
      .eq("id", answerAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("AS-159: a client who is not a member of projectA cannot select its answers", async () => {
    const { data, error } = await outsiderClientSession
      .from("brief_answers")
      .select("id")
      .eq("id", answerAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // --- AS-160: a client cannot answer when the project's portal is
  // disabled ----------------------------------------------------------------

  it("AS-160: a client cannot write an answer when the project's portal is disabled", async () => {
    const { error } = await clientSession.from("brief_answers").insert({
      brief_id: briefDisabledId,
      question_id: questionDisabledId,
      question_prompt_snapshot: "Disabled project question",
      answer_text: "Should not be allowed",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("AS-160: a client cannot even SELECT answers of a portal-disabled project", async () => {
    const { data: existingAnswer, error: insertErr } = await admin
      .from("brief_answers")
      .insert({
        brief_id: briefDisabledId,
        question_id: questionDisabledId,
        question_prompt_snapshot: "Disabled project question",
        answer_text: "seed",
      })
      .select("id")
      .single();
    expect(insertErr).toBeNull();

    const { data, error } = await clientSession
      .from("brief_answers")
      .select("id")
      .eq("id", existingAnswer!.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await admin.from("brief_answers").delete().eq("id", existingAnswer!.id);
  });

  // --- positive case: the exception that makes the risk worth it --------

  it("positive: a client of a portal-enabled project can write an answer to their own project's non-approved brief", async () => {
    const { error: updateError } = await clientSession
      .from("brief_answers")
      .update({ answer_text: "Updated by client" })
      .eq("id", answerAId);
    expect(updateError).toBeNull();

    const { data: check } = await admin.from("brief_answers").select("answer_text").eq("id", answerAId).single();
    expect(check?.answer_text).toBe("Updated by client");

    const { data: created, error: createError } = await clientSession
      .from("brief_answers")
      .insert({
        brief_id: briefAId,
        question_prompt_snapshot: "Freeform client answer",
        answer_text: "New answer by client",
      })
      .select("id")
      .single();
    expect(createError).toBeNull();
    expect(created).not.toBeNull();

    await admin.from("brief_answers").delete().eq("id", created!.id);
  });

  // --- negative case: approval freezes answers, even for the client -----

  it("negative: a client cannot write an answer once the brief's state is 'approved'", async () => {
    const { error: approveError } = await admin.from("briefs").update({ state: "approved" }).eq("id", briefAId);
    expect(approveError).toBeNull();

    try {
      // Without `.select()`/`{count: 'exact'}`, a PostgREST UPDATE that
      // matches zero rows because RLS filtered the row out returns
      // `error: null` (success, nothing to report) — the same shape as a
      // genuinely permitted no-op. `count` is the only reliable signal
      // that the RLS `using` clause excluded the row rather than the
      // write actually applying.
      const { error: updateError, count: updateCount } = await clientSession
        .from("brief_answers")
        .update({ answer_text: "Attempted post-approval edit" }, { count: "exact" })
        .eq("id", answerAId);
      if (updateError) {
        expect(updateError.code).toBe(RLS_DENIED);
      } else {
        expect(updateCount).toBe(0);
      }

      // The freeze applies to the team as well — standing decision #16
      // carves out no team-only escape hatch.
      const { error: teamUpdateError, count: teamUpdateCount } = await memberSession
        .from("brief_answers")
        .update({ answer_text: "Attempted team post-approval edit" }, { count: "exact" })
        .eq("id", answerAId);
      if (teamUpdateError) {
        expect(teamUpdateError.code).toBe(RLS_DENIED);
      } else {
        expect(teamUpdateCount).toBe(0);
      }

      const { data: check } = await admin.from("brief_answers").select("answer_text").eq("id", answerAId).single();
      expect(check?.answer_text).toBe("Updated by client");
    } finally {
      // Revert so any later test / cleanup is unaffected, even if an
      // assertion above threw.
      await admin.from("briefs").update({ state: "draft" }).eq("id", briefAId);
    }
  });

  // --- briefs: client may only move draft -> submitted ------------------

  it("a client can submit a draft brief (draft -> submitted)", async () => {
    try {
      const { error } = await clientSession.from("briefs").update({ state: "submitted" }).eq("id", briefAId);
      expect(error).toBeNull();
      const { data } = await admin.from("briefs").select("state").eq("id", briefAId).single();
      expect(data?.state).toBe("submitted");
    } finally {
      await admin.from("briefs").update({ state: "draft" }).eq("id", briefAId);
    }
  });

  it("a client cannot move a brief to any state other than 'submitted'", async () => {
    const { error, count } = await clientSession
      .from("briefs")
      .update({ state: "approved" }, { count: "exact" })
      .eq("id", briefAId);
    if (error) {
      expect(error.code).toBe(RLS_DENIED);
    } else {
      expect(count).toBe(0);
    }
    const { data } = await admin.from("briefs").select("state").eq("id", briefAId).single();
    expect(data?.state).toBe("draft");
  });

  it("a client cannot update a brief that is not currently 'draft'", async () => {
    await admin.from("briefs").update({ state: "submitted" }).eq("id", briefAId);
    const { error } = await clientSession.from("briefs").update({ state: "submitted" }).eq("id", briefAId);
    // No row matches the using() clause (state = 'draft' required), so
    // the update affects zero rows without necessarily erroring.
    if (error) {
      expect(error.code).toBe(RLS_DENIED);
    }
    const { data } = await admin.from("briefs").select("state").eq("id", briefAId).single();
    expect(data?.state).toBe("submitted");
    await admin.from("briefs").update({ state: "draft" }).eq("id", briefAId);
  });

  // --- brief_answer_revisions: tightened SELECT stays project-scoped ----

  it("regression: brief_answer_revisions SELECT stays project-scoped after tightening (outsider client sees none)", async () => {
    const { data, error } = await outsiderClientSession
      .from("brief_answer_revisions")
      .select("id")
      .eq("answer_id", answerAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("regression: brief_answer_revisions still has no UPDATE/DELETE policy for any role (AS-134/AS-135 preserved)", async () => {
    const { error: updateError, count: updateCount } = await memberSession
      .from("brief_answer_revisions")
      .update({ previous_text: "tampered" }, { count: "exact" })
      .eq("answer_id", answerAId);
    if (updateError) {
      expect(updateError.code).toBe(RLS_DENIED);
    } else {
      expect(updateCount).toBe(0);
    }

    const { error: deleteError, count: deleteCount } = await memberSession
      .from("brief_answer_revisions")
      .delete({ count: "exact" })
      .eq("answer_id", answerAId);
    if (deleteError) {
      expect(deleteError.code).toBe(RLS_DENIED);
    } else {
      expect(deleteCount).toBe(0);
    }
  });
});
