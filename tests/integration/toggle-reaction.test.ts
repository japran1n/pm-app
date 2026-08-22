// Integration tests for F200's toggleReaction Server Action (AS-367:
// clicking an existing reaction removes it) — run against the real linked
// Supabase project, same loadDotEnv/skipIf/mocked-createClient-returns-real-
// session pattern tests/integration/watchers.test.ts (F164) already
// established for a self-serve, RLS-enforced write action.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F200: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Swapped per test — the currently "signed in" per-user client that the
// mocked createClient() returns.
let currentSessionClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)("toggleReaction (F200: AS-367)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let commentId: string;
  let memberEmail: string;
  let memberPassword: string;
  let memberUserId: string;
  let memberClient: SupabaseClient;
  let viewerEmail: string;
  let viewerPassword: string;
  let viewerUserId: string;
  let viewerClient: SupabaseClient;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F200 workspace", slug: `f200-reactions-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    memberEmail = `f200-member-${uniqueSuffix}@example.com`;
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
    createdUserIds.push(memberUserId);

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: "member",
      status: "active",
    });
    if (memberInsertErr) {
      throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
    }

    viewerEmail = `f200-viewer-${uniqueSuffix}@example.com`;
    viewerPassword = "Test-password-1!";
    const { data: viewerAuth, error: viewerAuthErr } =
      await adminClient.auth.admin.createUser({
        email: viewerEmail,
        password: viewerPassword,
        email_confirm: true,
      });
    if (viewerAuthErr || !viewerAuth.user) {
      throw new Error(`Failed to create viewer user: ${viewerAuthErr?.message}`);
    }
    viewerUserId = viewerAuth.user.id;
    createdUserIds.push(viewerUserId);

    const { error: viewerInsertErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: viewerUserId,
      role: "viewer",
      status: "active",
    });
    if (viewerInsertErr) {
      throw new Error(`Failed to seed viewer: ${viewerInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: `F200 Project ${uniqueSuffix}`, created_by: memberUserId })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
    projectId = proj.id;

    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({ project_id: projectId, title: `F200 Task ${uniqueSuffix}`, author_id: memberUserId })
      .select("id")
      .single();
    if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);
    taskId = task.id;

    const { data: comment, error: commentErr } = await adminClient
      .from("comments")
      .insert({ task_id: taskId, user_id: memberUserId, text: "F200 comment to react to" })
      .select("id")
      .single();
    if (commentErr || !comment) throw new Error(`Failed to create comment: ${commentErr?.message}`);
    commentId = comment.id;

    memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: memberSignInErr } = await memberClient.auth.signInWithPassword({
      email: memberEmail,
      password: memberPassword,
    });
    if (memberSignInErr) {
      throw new Error(`Failed to sign in member test user: ${memberSignInErr.message}`);
    }

    viewerClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: viewerSignInErr } = await viewerClient.auth.signInWithPassword({
      email: viewerEmail,
      password: viewerPassword,
    });
    if (viewerSignInErr) {
      throw new Error(`Failed to sign in viewer test user: ${viewerSignInErr.message}`);
    }
  });

  beforeEach(() => {
    currentSessionClient = memberClient;
  });

  afterAll(async () => {
    if (commentId) await adminClient.from("comment_reactions").delete().eq("comment_id", commentId);
    if (commentId) await adminClient.from("comments").delete().eq("id", commentId);
    if (taskId) await adminClient.from("tasks").delete().eq("id", taskId);
    if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  it("AS-367: toggling on inserts a reaction row for the caller", async () => {
    const { toggleReaction } = await import("@/lib/actions/comment-reactions");

    const result = await toggleReaction(commentId, "👍");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reacted).toBe(true);

    const { data: row, error } = await adminClient
      .from("comment_reactions")
      .select("comment_id, user_id, emoji")
      .eq("comment_id", commentId)
      .eq("user_id", memberUserId)
      .eq("emoji", "👍")
      .maybeSingle();
    expect(error).toBeNull();
    expect(row).not.toBeNull();
  });

  it("AS-367: clicking an existing reaction removes it (double-toggle: on, then off, row genuinely gone)", async () => {
    const { toggleReaction } = await import("@/lib/actions/comment-reactions");

    const first = await toggleReaction(commentId, "❤️");
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.reacted).toBe(true);

    const { data: afterFirst } = await adminClient
      .from("comment_reactions")
      .select("emoji")
      .eq("comment_id", commentId)
      .eq("user_id", memberUserId)
      .eq("emoji", "❤️");
    expect(afterFirst?.length).toBe(1);

    const second = await toggleReaction(commentId, "❤️");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.reacted).toBe(false);

    const { data: afterSecond, error } = await adminClient
      .from("comment_reactions")
      .select("emoji")
      .eq("comment_id", commentId)
      .eq("user_id", memberUserId)
      .eq("emoji", "❤️");
    expect(error).toBeNull();
    expect(afterSecond).toEqual([]);
  });

  it("AS-367: two rapid/concurrent toggles for the same user+comment+emoji do not crash on the unique constraint, and converge to a single correct end state", async () => {
    const { toggleReaction } = await import("@/lib/actions/comment-reactions");

    // Guarantee a clean starting state for this emoji.
    await adminClient
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", memberUserId)
      .eq("emoji", "🎉");

    // Fire two toggles concurrently — this is the race the unique
    // constraint (not a client-side read-then-branch) must resolve: one
    // insert wins, the other hits 23505 and is caught, converted into a
    // delete rather than propagating a crash or duplicate row.
    const [resultA, resultB] = await Promise.all([
      toggleReaction(commentId, "🎉"),
      toggleReaction(commentId, "🎉"),
    ]);

    // Neither call should have surfaced an unhandled/raw database error.
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);

    // Exactly one final row (either present once, or absent) — never
    // duplicated, never errored.
    const { data: rows, error } = await adminClient
      .from("comment_reactions")
      .select("emoji")
      .eq("comment_id", commentId)
      .eq("user_id", memberUserId)
      .eq("emoji", "🎉");
    expect(error).toBeNull();
    expect(rows?.length).toBeLessThanOrEqual(1);
  });

  it("AS-367 negative: an invalid emoji outside the allow-list is rejected before reaching the database", async () => {
    const { toggleReaction } = await import("@/lib/actions/comment-reactions");

    const result = await toggleReaction(commentId, "🍕");
    expect(result.ok).toBe(false);

    const { data: rows } = await adminClient
      .from("comment_reactions")
      .select("emoji")
      .eq("comment_id", commentId)
      .eq("user_id", memberUserId)
      .eq("emoji", "🍕");
    expect(rows ?? []).toHaveLength(0);
  });

  it("AS-367 negative: a viewer cannot toggle a reaction (canWrite gate)", async () => {
    const { toggleReaction } = await import("@/lib/actions/comment-reactions");

    currentSessionClient = viewerClient;
    const result = await toggleReaction(commentId, "🚀");
    expect(result.ok).toBe(false);

    const { data: rows } = await adminClient
      .from("comment_reactions")
      .select("emoji")
      .eq("comment_id", commentId)
      .eq("user_id", viewerUserId)
      .eq("emoji", "🚀");
    expect(rows ?? []).toHaveLength(0);
  });

  it("AS-367 negative: an unauthenticated caller cannot toggle a reaction", async () => {
    const { toggleReaction } = await import("@/lib/actions/comment-reactions");

    currentSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!); // no session

    const result = await toggleReaction(commentId, "👀");
    expect(result.ok).toBe(false);
  });
});
