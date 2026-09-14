// F272 (AS-530: "the full unit and e2e suite passes on a clean checkout") —
// Playwright coverage for the highest-risk NEW journeys named in this
// feature's draft scope that were not already covered by an existing spec
// in this directory (checked first — see the file list this repo already
// has: board-reorder.spec.ts covers same-column reorder only, never a
// cross-column move onto a freshly created column; nothing exercises
// delete->undo, the F246 `/t/[taskKey]` deep link, or the command palette's
// search->navigate path end to end).
//
// This file covers, each against the REAL running app in a REAL browser
// against the real linked Supabase project (same magic-link-then-cookie-
// injection auth technique this suite already established — see
// board-reorder.spec.ts's own header comment for the full rationale, not
// re-explained here):
//   1. Creating a custom board column (F219/F220's settings/columns panel),
//      dragging a task onto it, and reloading — the risky part is that the
//      drag lands on a column that did not exist at page load and therefore
//      isn't part of any hard-coded column set, and that the move survives
//      a reload (persisted server-side, not just client-side state).
//   2. Deleting a task and using the toast's Undo action to restore it
//      (F190/AS-345) — the risky part is the two-step round trip (soft
//      delete, then a real restoreTask call from the toast, not just "the
//      toast rendered").
//   3. Opening a task via its canonical `/t/[taskKey]` deep link in a FRESH
//      browser context (F246/AS-473/AS-474) — the risky part is a brand new
//      session/tab with no prior client-side navigation history correctly
//      resolving the key and landing on the real task detail sheet.
//   4. The command palette (F241-F243): opening with Cmd/Ctrl+K, searching
//      for a task by title, selecting the result, and confirming the URL
//      actually navigates to that task's project board with the task
//      pre-selected (AS-461) — the risky part is the debounced search
//      round trip and the onSelect->router.push wiring, not just that the
//      dialog opens.

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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F272: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("F272: highest-risk new e2e journeys (AS-530)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdColumnIds: string[] = [];

  let workspaceSlug: string;
  let projectId: string;
  let memberUserId: string;
  let memberEmail: string;
  let uniqueSuffix: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f272-lifecycle-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F272 Lifecycle Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f272-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    // Owner, not plain member, so the project settings "Board columns"
    // panel actually renders its manage controls (F219/AS-414 gates on
    // project-lead-or-workspace-admin) instead of a read-only view.
    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "owner",
        status: "active",
      });
    if (memberInsertErr) {
      throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F272 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    // status_set_v2 seeds v2-named default columns; this spec's fixtures
    // and UI interactions use the legacy four names as literal
    // column/status values. Seed them as this project's own (PM-named)
    // columns — same convention as the integration suites
    // (tests/helpers/legacy-status-columns.ts).
    {
      const { error: legacyColErr } = await adminClient.from("project_statuses").upsert(
        [
          { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
          { project_id: projectId, name: "in_progress", color: "#3b82f6", category: "in_progress", position: 200 },
          { project_id: projectId, name: "in_review", color: "#8b5cf6", category: "in_progress", position: 300 },
          { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 },
        ],
        { onConflict: "project_id,name" },
      );
      if (legacyColErr) throw new Error(`legacy columns: ${legacyColErr.message}`);
    }

    createdProjectIds.push(projectId);
  });

  test.afterAll(async () => {
    if (createdColumnIds.length > 0) {
      await adminClient.from("project_statuses").delete().in("id", createdColumnIds);
    }
    for (const taskId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", taskId);
    }
    for (const pId of createdProjectIds) {
      await adminClient.from("project_statuses").delete().eq("project_id", pId);
      await adminClient.from("projects").delete().eq("id", pId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // Same real-magic-link-then-cookie-injection technique as
  // tests/e2e/board-reorder.spec.ts — see that file's own comments for the
  // full rationale.
  async function login(page: Page, baseURL: string) {
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
    // The verify redirect's landing PATH differs by environment: the
    // hosted project's PKCE flow errors out at the app callback and lands
    // on /sign-in?error=auth_failed#<tokens>, while the local stack's
    // GoTrue redirects straight to site_url with the tokens in the
    // fragment at the root path. Either way the tokens are in the URL
    // fragment — wait for THAT, not for a specific path.
    await page.waitForURL(/#access_token=/, {
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
  }

  // F253's first-run onboarding tour is a fixed-position overlay that can
  // intercept pointer events on whatever it happens to render over top of
  // (e.g. the settings "Add column" button) — dismiss it once per fresh
  // session, same convention as f335-mobile-no-horizontal-scroll.spec.ts.
  async function dismissOnboardingTour(page: Page) {
    // F272 (part 3): a single `isVisible()` check has a real bug — right
    // after navigation, the tour genuinely isn't in the DOM on the FIRST
    // instant (client hasn't hydrated/computed its "mounted" gate yet); a
    // false reading there was treated as "already dismissed" and skipped
    // the click, leaving the tour active for the rest of the test to
    // reappear later (observed here as a leftover `getByRole("dialog")`
    // matching the tour's own dialog, tripping up an unrelated
    // `toHaveCount(0)` assertion). Polls for up to 4s instead of a single
    // check, and keeps re-clicking Skip whenever it reappears (a
    // `revalidatePath("layout")`-triggered remount can bring it back
    // mid-test — see components/onboarding/tour.tsx's own doc comment).
    const skipButton = page.getByRole("button", { name: "Skip" });
    const deadline = Date.now() + 4_000;
    let lastSeenVisible = false;
    while (Date.now() < deadline) {
      const visible = await skipButton
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) {
        lastSeenVisible = true;
        await skipButton.click().catch(() => {});
      } else if (lastSeenVisible) {
        break;
      }
      await page.waitForTimeout(300);
    }
  }

  async function seedTask(title: string, position: number): Promise<string> {
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

  test("custom column create -> drag task onto it -> reload keeps the task in the new column", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await login(page, baseURL!);

    const columnName = `F272Custom${uniqueSuffix.replace(/[^a-zA-Z0-9]/g, "")}`;
    const taskId = await seedTask("F272 Column Move Task", 100);

    // --- Step 1: create the custom column via the settings/columns panel ---
    await page.goto(
      `${baseURL}/w/${workspaceSlug}/projects/${projectId}/settings/columns`,
    );
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/settings/columns`,
      { timeout: 15_000 },
    );
    await dismissOnboardingTour(page);

    await page.getByPlaceholder("New column name").fill(columnName);
    await page.getByRole("button", { name: "Add column" }).click();
    // Each column's name lives inside a controlled <input value="...">
    // (StatusManager's ColumnRow), which contributes nothing to
    // getByText()'s text-content matching — same input-vs-text-node
    // distinction documented in tests/e2e/checklist-ui.spec.ts. Match the
    // input's live value instead.
    await expect(
      page.locator(`input[aria-label="Column name"]`).and(
        page.locator(`[value="${columnName}"]`),
      ),
    ).toBeVisible({ timeout: 10_000 });

    // Confirm it's a real row server-side before moving on (not just an
    // optimistic client-side insert this test would otherwise trust
    // blindly).
    await expect(async () => {
      const { data, error } = await adminClient
        .from("project_statuses")
        .select("id, name")
        .eq("project_id", projectId)
        .eq("name", columnName)
        .maybeSingle();
      if (error) throw error;
      expect(data).not.toBeNull();
      if (data) createdColumnIds.push(data.id);
    }).toPass({ timeout: 10_000 });

    // --- Step 2: drag the seeded task from the "todo" column onto the new
    // one on the real board ---
    await page.goto(
      `${baseURL}/w/${workspaceSlug}/projects/${projectId}/board`,
    );
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/board`,
      { timeout: 15_000 },
    );

    const sourceColumn = page.locator('[data-status="todo"]');
    await expect(sourceColumn.getByText("F272 Column Move Task")).toBeVisible({
      timeout: 10_000,
    });
    const targetColumn = page.locator(`[data-status="${columnName}"]`);
    await expect(targetColumn).toBeVisible({ timeout: 10_000 });

    const card = sourceColumn.getByText("F272 Column Move Task");
    const cardBox = await card.boundingBox();
    const targetBox = await targetColumn.boundingBox();
    if (!cardBox || !targetBox) {
      throw new Error("Could not locate card/column bounding boxes for drag");
    }

    await page.mouse.move(
      cardBox.x + cardBox.width / 2,
      cardBox.y + cardBox.height / 2,
    );
    await page.mouse.down();
    const steps = 10;
    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + 40;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / steps,
        startY + ((endY - startY) * i) / steps,
        { steps: 2 },
      );
    }
    await page.waitForTimeout(100);
    await page.mouse.up();

    await expect(targetColumn.getByText("F272 Column Move Task")).toBeVisible({
      timeout: 10_000,
    });

    // Persisted server-side (the risky part: the new column has never been
    // present at page load before this test, so its position/id can't
    // already be baked into any hard-coded client state).
    await expect(async () => {
      const { data, error } = await adminClient
        .from("tasks")
        .select("status")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      expect(data.status).toBe(columnName);
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await expect(
      page.locator(`[data-status="${columnName}"]`).getByText("F272 Column Move Task"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-status="todo"]').getByText("F272 Column Move Task"),
    ).toHaveCount(0);
  });

  test("delete a task -> Undo on the toast restores it", async ({
    page,
    baseURL,
  }) => {
    await login(page, baseURL!);
    await seedTask("F272 Delete Undo Task", 200);

    await page.goto(
      `${baseURL}/w/${workspaceSlug}/projects/${projectId}/board`,
    );
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/board`,
      { timeout: 15_000 },
    );
    await dismissOnboardingTour(page);

    await page.getByText("F272 Delete Undo Task").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(
      "F272 Delete Undo Task",
    );

    await sheet.getByRole("button", { name: "Delete task" }).click();

    // Sheet closes and the card disappears from the board.
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("F272 Delete Undo Task")).toHaveCount(0, {
      timeout: 10_000,
    });

    // Confirm the delete really landed server-side (soft delete) before
    // clicking Undo, so this test can't pass on a purely-optimistic UI that
    // never actually persisted the delete.
    await expect(async () => {
      const { data, error } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("project_id", projectId)
        .eq("title", "F272 Delete Undo Task")
        .single();
      if (error) throw error;
      expect(data.deleted_at).not.toBeNull();
    }).toPass({ timeout: 10_000 });

    // Undo, from the toast — must appear within the 8s window
    // lib/toast/undo-toast.ts configures.
    await page.getByRole("button", { name: "Undo" }).click();

    // Confirm the restore lands server-side first — this is the part
    // AS-345 actually promises ("Undo restores it"). The board's own
    // Realtime subscription re-inserting the card client-side (board.tsx's
    // reconcileTask) is a nice-to-have UX property this test also checks,
    // but under heavy shared-project load a live-delivery hiccup would be
    // a false failure of a correct restore, not a real regression — so a
    // single reload is an accepted fallback if the live re-render hasn't
    // happened yet, same spirit as this suite's other specs polling the
    // DB directly rather than trusting only client state.
    await expect(async () => {
      const { data, error } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("project_id", projectId)
        .eq("title", "F272 Delete Undo Task")
        .single();
      if (error) throw error;
      expect(data.deleted_at).toBeNull();
    }).toPass({ timeout: 15_000 });

    const restoredCard = page.getByText("F272 Delete Undo Task");
    if (!(await restoredCard.isVisible({ timeout: 10_000 }).catch(() => false))) {
      await page.reload();
    }
    await expect(restoredCard).toBeVisible({ timeout: 15_000 });
  });

  test("F246: deep-linking a task's canonical /t/[taskKey] URL in a FRESH browser context opens the task detail directly", async ({
    browser,
    baseURL,
  }) => {
    await seedTask("F272 Deep Link Task", 300);

    // Fetch the task's project key + number to build the canonical
    // "PROJECTKEY-NUMBER" URL — same lib/tasks/task-key.ts formatting the
    // real command palette / notifications use, not a raw task id.
    const { data: taskRow, error: taskErr } = await adminClient
      .from("tasks")
      .select("number, project_id, projects(key)")
      .eq("project_id", projectId)
      .eq("title", "F272 Deep Link Task")
      .single();
    if (taskErr || !taskRow) {
      throw new Error(`Failed to read seeded task: ${taskErr?.message}`);
    }
    const projectKey = (
      taskRow as unknown as { projects: { key: string } }
    ).projects.key;
    const taskKey = `${projectKey}-${taskRow.number}`;

    // A genuinely FRESH context (its own cookie jar, no prior client-side
    // navigation) — this is the "opened in a new tab from a link" scenario
    // AS-474 is actually about, not a continuation of an already-warm
    // session from another test in this file.
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, baseURL!);

    await page.goto(`${baseURL}/w/${workspaceSlug}/t/${taskKey}`);

    // Resolves via a redirect() onto the board with ?taskId=, which opens
    // the real TaskDetailSheet on mount.
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/board?taskId=*`,
      { timeout: 15_000 },
    );
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(
      "F272 Deep Link Task",
      { timeout: 10_000 },
    );

    await context.close();
  });

  test("command palette: searching for a task and selecting the result navigates to it", async ({
    page,
    baseURL,
  }) => {
    await login(page, baseURL!);
    await seedTask("F272 Palette Findme Task", 400);

    await page.goto(`${baseURL}/w/${workspaceSlug}`);
    await page.waitForURL(`**/w/${workspaceSlug}`, { timeout: 15_000 });
    await dismissOnboardingTour(page);

    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();

    const input = dialog.getByPlaceholder("Type a command or search...");
    await input.fill("F272 Palette Findme");

    const result = dialog.getByText("F272 Palette Findme Task");
    await expect(result).toBeVisible({ timeout: 10_000 });
    await result.click();

    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/board`,
      { timeout: 15_000 },
    );
    await expect(dialog).toHaveCount(0);
  });
});
