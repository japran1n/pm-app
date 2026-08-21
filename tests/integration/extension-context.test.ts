// Integration test for F293 (AS-555, AS-556, AS-557), run against the real
// linked Supabase project — mirrors
// tests/integration/extension-create-task.test.ts's real-signInWithPassword
// pattern and the same "import the exported Route Handler function, invoke
// with a real NextRequest" convention.
//
// The core of this file is AS-557: prove the endpoint returns EXACTLY the
// caller's own workspaces/projects/members, verified against a real SECOND
// workspace the caller is NOT a member of, which must never appear in the
// response — not merely hidden by client-side filtering of a response that
// secretly included it.

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
if (process.env.CI && !haveCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

async function getExtensionContext(
  token?: string,
  workspaceId?: string,
): Promise<Response> {
  const { GET } = await import("@/app/api/extension/context/route");
  const url = workspaceId
    ? `http://localhost:3000/api/extension/context?workspaceId=${workspaceId}`
    : "http://localhost:3000/api/extension/context";
  const request = new NextRequest(url, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return GET(request);
}

describe.skipIf(!haveCreds)(
  "GET /api/extension/context (F293: AS-555, AS-556, AS-557)",
  () => {
    let adminClient: SupabaseClient;
    // Workspace A: the caller IS a member of this one.
    let workspaceAId: string;
    let projectAId: string;
    let memberUserId: string;
    let memberEmail: string;
    let memberPassword: string;
    let memberAccessToken: string;
    // Workspace B: the caller is NOT a member of this one — must NEVER
    // appear in any response for this caller (AS-557's real security case).
    let workspaceBId: string;
    let projectBId: string;
    let otherUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F293 workspace A", slug: `f293-ws-a-${suffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: projA, error: projAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F293 project A" })
        .select("id")
        .single();
      if (projAErr || !projA) throw new Error(`Failed to create project A: ${projAErr?.message}`);
      projectAId = projA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F293 workspace B", slug: `f293-ws-b-${suffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      const { data: projB, error: projBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "F293 project B (must never appear)" })
        .select("id")
        .single();
      if (projBErr || !projB) throw new Error(`Failed to create project B: ${projBErr?.message}`);
      projectBId = projB.id;

      memberEmail = `f293-member-${suffix}@example.com`;
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
        .insert({ workspace_id: workspaceAId, user_id: memberUserId, role: "owner", status: "active" });
      if (memberInsertErr) throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);

      // A second, unrelated user IS a member of workspace B — proves
      // workspace B genuinely has members/projects, it's just that OUR
      // caller (memberUserId) is not one of them.
      const otherEmail = `f293-other-${suffix}@example.com`;
      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: otherEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other user: ${otherAuthErr?.message}`);
      }
      otherUserId = otherAuth.user.id;
      const { error: otherInsertErr } = await adminClient
        .from("workspace_members")
        .insert({ workspace_id: workspaceBId, user_id: otherUserId, role: "owner", status: "active" });
      if (otherInsertErr) throw new Error(`Failed to seed other membership: ${otherInsertErr.message}`);

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
    });

    afterAll(async () => {
      for (const id of [projectAId, projectBId]) {
        if (id) await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of [workspaceAId, workspaceBId]) {
        if (id) {
          await adminClient.from("workspace_members").delete().eq("workspace_id", id);
          await adminClient.from("workspaces").delete().eq("id", id);
        }
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
      if (otherUserId) await adminClient.auth.admin.deleteUser(otherUserId);
    });

    it("AS-555/AS-557: the workspace list contains only workspace A, never workspace B", async () => {
      const res = await getExtensionContext(memberAccessToken);
      expect(res.status).toBe(200);
      const json = await res.json();
      const ids = json.workspaces.map((w: { id: string }) => w.id);
      expect(ids).toContain(workspaceAId);
      expect(ids).not.toContain(workspaceBId);
    });

    it("AS-555/AS-557: projects/members for workspace A are returned, scoped correctly", async () => {
      const res = await getExtensionContext(memberAccessToken, workspaceAId);
      expect(res.status).toBe(200);
      const json = await res.json();
      const projectIds = json.projects.map((p: { id: string }) => p.id);
      expect(projectIds).toContain(projectAId);
      expect(projectIds).not.toContain(projectBId);
      const memberIds = json.members.map((m: { id: string }) => m.id);
      expect(memberIds).toContain(memberUserId);
      expect(memberIds).not.toContain(otherUserId);
    });

    it("AS-557: requesting workspace B's context (a workspace the caller is NOT a member of) is rejected with 403 and returns none of B's data", async () => {
      const res = await getExtensionContext(memberAccessToken, workspaceBId);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.projects).toBeUndefined();
      expect(json.members).toBeUndefined();
      const text = JSON.stringify(json);
      expect(text).not.toContain(projectBId);
    });

    it("AS-557: a request with no Authorization header is rejected with 401", async () => {
      const res = await getExtensionContext();
      expect(res.status).toBe(401);
    });
  },
);
