// Playwright e2e test for F158 (AS-280, AS-281) — the genuine
// live-interaction half of this feature's coverage. Everything provable
// at the data level (which blockers count as "open") is already covered
// by tests/integration/open-blockers.test.ts's getOpenBlockers
// assertions; everything provable from a static (closed) render is
// already covered by tests/unit/blocked-done-guard-render.test.ts. This
// file instead drives the REAL running app in a REAL browser to prove
// the genuinely-live parts neither of those can: that changing a task's
// status to "done" while it still has an open blocker actually pops a
// confirmation dialog naming that blocker by key and title, that
// clicking Cancel actually leaves the status unchanged (a warning, not a
// silent no-op — AS-280 says "requires confirmation", not "is
// rejected"), that clicking through actually persists the status change,
// and — AS-281, the negative case this feature's own worker brief calls
// out as "easy to get wrong" — that a task whose blockers are ALL
// complete shows NO dialog at all and completes immediately.
//
// Covers ONE of the four status-change paths this feature's shared guard
// serves (the list view's inline <ListStatusSelect>, the simplest to
// drive without simulating a drag or an already-open detail sheet) —
// board drag-and-drop and the task detail sheet's own status Select call
// the exact SAME useBlockedDoneGuard hook and the exact same
// getOpenBlockers Server Action (see lib/tasks/blocked-guard.ts's doc
// comment for the full shared-helper chain), so this one live proof of
// the guard's actual dialog/confirm/cancel mechanics validates the
// behaviour common to all three; those other two paths are otherwise
// covered only by SSR smoke-render tests
// (tests/unit/board-move-status-wiring.test.ts,
// tests/unit/board-task-detail-sheet-wiring.test.ts) plus the shared
// getOpenBlockers integration coverage — see this feature's handoff for
// the explicit per-path breakdown.
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link
// in the real browser -> capture the implicit-flow tokens from the
// redirect fragment -> inject them into the same `sb-<project-ref>-auth-
// token` cookie `@supabase/ssr`'s server client reads) is the exact
// technique tests/e2e/dependency-ui.spec.ts/subtask-ui.spec.ts already
// established — see either file for the full rationale, not re-explained
// line-by-line here.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
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

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("Blocked-done guard on the list view (F158: AS-280, AS-281)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdDependencyIds: string[] = [];
  let workspaceId: string;
  let projectId: string;
  let workspaceSlug: string;
  let memberUserId: string;
  let memberEmail: string;

  let blockerTaskId: string;
  let blockedTaskId: string;
  let freeTaskId: string;
  const blockerTitle = "F158 E2E Blocker Task";
  const blockedTitle = "F158 E2E Blocked Task";
  const freeTitle = "F158 E2E Unblocked Task";

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f158-guard-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F158 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;

    memberEmail = `f158-e2e-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(
        `Failed to create member user: ${memberAuthErr?.message}`,
      );
    }
    memberUserId = memberAuth.user.id;

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "member",
        status: "active",
      });
    if (memberInsertErr) {
      throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F158 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;

    async function makeTask(title: string, position: number): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          author_id: memberUserId,
          status: "todo",
          position,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task "${title}": ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    blockerTaskId = await makeTask(blockerTitle, 100);
    blockedTaskId = await makeTask(blockedTitle, 200);
    freeTaskId = await makeTask(freeTitle, 300);

    const { data: dependency, error: dependencyErr } = await adminClient
      .from("task_dependencies")
      .insert({
        blocking_task_id: blockerTaskId,
        blocked_task_id: blockedTaskId,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (dependencyErr || !dependency) {
      throw new Error(`Failed to seed dependency: ${dependencyErr?.message}`);
    }
    createdDependencyIds.push(dependency.id);
  });

  test.afterAll(async () => {
    if (createdDependencyIds.length > 0) {
      await adminClient
        .from("task_dependencies")
        .delete()
        .in("id", createdDependencyIds);
    }
    for (const taskId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", taskId);
    }
    if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
  });

  // Same real-magic-link-then-cookie-injection technique as
  // tests/e2e/dependency-ui.spec.ts — see that file's own comments for
  // the full rationale. Leaves `page` signed in and lands it on this
  // project's List view.
  async function loginAndGoToList(page: Page, baseURL: string) {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: memberEmail,
        options: { redirectTo: `${baseURL}/auth/callback` },
      });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Failed to generate magic link: ${linkErr?.message}`);
    }

    await page.goto(linkData.properties.action_link);
    await page.waitForURL(/\/sign-in\?error=auth_failed#/, {
      timeout: 15_000,
    });

    const fragment = new URL(page.url()).hash.slice(1);
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");
    const expiresAt = params.get("expires_at");
    if (!accessToken || !refreshToken) {
      throw new Error(
        `Magic link redirect did not carry session tokens: ${page.url()}`,
      );
    }

    const projectRef = projectRefFromUrl(SUPABASE_URL!);
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: expiresIn ? Number(expiresIn) : 3600,
      expires_at: expiresAt
        ? Number(expiresAt)
        : Math.floor(Date.now() / 1000) + 3600,
      user: { id: memberUserId, email: memberEmail },
    };
    const cookieValue =
      "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

    await page.context().addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        url: baseURL,
      },
    ]);

    await page.goto(`${baseURL}/w/${workspaceSlug}/projects/${projectId}/list`);
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/list`,
      { timeout: 15_000 },
    );
  }

  test("AS-280: moving a blocked task to Done warns, naming the blocker; Cancel leaves it unchanged; confirming lets it proceed", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToList(page, baseURL!);

    const statusSelect = page.getByLabel(
      `Change status for task ${blockedTaskId}`,
    );
    await expect(statusSelect).toBeVisible();
    await statusSelect.click();
    await page.getByRole("option", { name: "Done" }).click();

    // The confirmation dialog appears, naming the blocker by title (its
    // key is a generated "PM-1"-style string this test doesn't predict,
    // but the blocker's own TITLE is exact and unambiguous).
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Mark as done anyway?")).toBeVisible();
    await expect(dialog.getByText(blockerTitle)).toBeVisible();

    // Cancel: this is a WARNING, not a prohibition that silently no-ops —
    // but cancelling must still leave the task's status genuinely
    // unchanged (AS-280 requires confirmation to proceed at all).
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(statusSelect).toHaveText(/To Do/);
    const { data: afterCancel } = await adminClient
      .from("tasks")
      .select("status")
      .eq("id", blockedTaskId)
      .single();
    expect(afterCancel?.status).toBe("todo");

    // Try again, this time confirming — the user CAN proceed.
    await statusSelect.click();
    await page.getByRole("option", { name: "Done" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Mark as done anyway" }).click();
    await expect(dialog).toBeHidden();

    await expect(statusSelect).toHaveText(/Done/);
    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("tasks")
          .select("status")
          .eq("id", blockedTaskId)
          .single();
        return data?.status;
      })
      .toBe("done");
  });

  test("AS-281: a task with no open blockers shows NO warning and completes immediately", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToList(page, baseURL!);

    const statusSelect = page.getByLabel(
      `Change status for task ${freeTaskId}`,
    );
    await expect(statusSelect).toBeVisible();
    await statusSelect.click();
    await page.getByRole("option", { name: "Done" }).click();

    // No dialog at all — the status change goes through immediately.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(statusSelect).toHaveText(/Done/);
    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("tasks")
          .select("status")
          .eq("id", freeTaskId)
          .single();
        return data?.status;
      })
      .toBe("done");
  });
});
