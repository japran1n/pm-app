// Integration test for F292 (AS-558, AS-561, AS-562, AS-572), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf and
// real signInWithPassword pattern established by
// tests/integration/rls-projects.test.ts, rather than mocking auth, so the
// membership/JWT checks in app/api/extension/tasks/route.ts are exercised
// for real.
//
// The route handler's POST() export is imported and invoked directly with
// a real `NextRequest`, rather than driving it through a running Next dev
// server — there is no existing convention in this repo for
// server-starting Route Handler tests (grep of tests/ turned up none), and
// this is the natural extension of this repo's existing "mock nothing that
// matters, hit the real database" integration test style to a Route
// Handler rather than a Server Action.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

async function postExtensionTask(
  body: unknown,
  token?: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/extension/tasks/route");
  const request = new NextRequest("http://localhost:3000/api/extension/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe.skipIf(!haveCreds)(
  "POST /api/extension/tasks (F292: AS-558, AS-561, AS-562, AS-572)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let memberEmail: string;
    let memberPassword: string;
    let memberAccessToken: string;
    let nonMemberUserId: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let nonMemberAccessToken: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F292 workspace", slug: `f292-ws-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F292 project" })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;

      memberEmail = `f292-member-${suffix}@example.com`;
      memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({ workspace_id: workspaceId, user_id: memberUserId, role: "owner", status: "active" });
      if (memberInsertErr) throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);

      nonMemberEmail = `f292-nonmember-${suffix}@example.com`;
      nonMemberPassword = "Test-password-1!";
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: nonMemberPassword,
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(`Failed to create non-member user: ${nonMemberAuthErr?.message}`);
      }
      nonMemberUserId = nonMemberAuth.user.id;
      // Non-member is not added to workspaceId's membership at all.

      const memberSignInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { data: memberSession, error: memberSignInErr } =
        await memberSignInClient.auth.signInWithPassword({
          email: memberEmail,
          password: memberPassword,
        });
      if (memberSignInErr || !memberSession.session) {
        throw new Error(`Failed to sign in member: ${memberSignInErr?.message}`);
      }
      memberAccessToken = memberSession.session.access_token;

      const nonMemberSignInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { data: nonMemberSession, error: nonMemberSignInErr } =
        await nonMemberSignInClient.auth.signInWithPassword({
          email: nonMemberEmail,
          password: nonMemberPassword,
        });
      if (nonMemberSignInErr || !nonMemberSession.session) {
        throw new Error(`Failed to sign in non-member: ${nonMemberSignInErr?.message}`);
      }
      nonMemberAccessToken = nonMemberSession.session.access_token;
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
      if (nonMemberUserId) await adminClient.auth.admin.deleteUser(nonMemberUserId);
    });

    it("AS-558: a real authenticated member creating a task via this route produces a real row visible via a normal query", async () => {
      const res = await postExtensionTask(
        { projectId, title: "F292 real task from extension" },
        memberAccessToken,
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.task.title).toBe("F292 real task from extension");
      createdTaskIds.push(json.task.id);

      const { data: row, error } = await adminClient
        .from("tasks")
        .select("id, title, project_id, author_id")
        .eq("id", json.task.id)
        .maybeSingle();
      expect(error).toBeNull();
      expect(row?.title).toBe("F292 real task from extension");
      expect(row?.project_id).toBe(projectId);
    });

    it("AS-561: the created task is attributed to the reporter (the JWT's user id), not any id in the body", async () => {
      const res = await postExtensionTask(
        {
          projectId,
          title: "F292 attribution task",
          // Deliberately no identity field exists on the schema to send —
          // this proves the route has nothing to trust from the body even
          // if a caller tried to smuggle one via an unrecognized field.
          userId: nonMemberUserId,
          authorId: nonMemberUserId,
        },
        memberAccessToken,
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      createdTaskIds.push(json.task.id);
      expect(json.task.authorId).toBe(memberUserId);
      expect(json.task.authorId).not.toBe(nonMemberUserId);
    });

    it("AS-562: a submission by an authenticated user who is NOT a member of the target project is rejected with 403 and creates no task", async () => {
      const { count: before } = await adminClient
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);

      const res = await postExtensionTask(
        { projectId, title: "should never be created" },
        nonMemberAccessToken,
      );
      expect(res.status).toBe(403);

      const { count: after } = await adminClient
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      expect(after).toBe(before);
    });

    it("AS-572: a request with no Authorization header is rejected with 401", async () => {
      const res = await postExtensionTask({ projectId, title: "no auth header" });
      expect(res.status).toBe(401);
    });

    it("AS-572: a request with a garbage/malformed token is rejected with 401", async () => {
      const res = await postExtensionTask(
        { projectId, title: "garbage token" },
        "not-a-real-jwt-at-all",
      );
      expect(res.status).toBe(401);
    });

    it("AS-572: a request with a syntactically JWT-shaped but signature-invalid (expired-equivalent) token is rejected with 401", async () => {
      // A well-formed-looking JWT (three base64url segments) whose payload
      // claims a far-past `exp` and whose signature was never produced by
      // this project's Supabase Auth — this fails signature verification
      // the same way a genuinely expired, previously-real token would once
      // its signing key material no longer validates. auth.getUser()
      // rejects both the same way (a single generic invalid/expired
      // outcome — see the route handler's comment on why AS-572 does not
      // distinguish the two).
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({ sub: memberUserId, exp: 1 }),
      ).toString("base64url");
      const fakeExpiredToken = `${header}.${payload}.invalidsignature`;

      const res = await postExtensionTask(
        { projectId, title: "expired token" },
        fakeExpiredToken,
      );
      expect(res.status).toBe(401);
    });
  },
);
