// Playwright e2e test for F022 (AS-103, AS-104, AS-066, AS-010, AS-071) —
// the docs assistant sidebar driven against the REAL running app (real
// login, real seeded workspace/doc, real Supabase RLS, real
// `/w/<slug>/docs/<docId>` editor page) with ONLY the model call itself
// stubbed at the network boundary (`page.route("**/api/ai/docs")`).
//
// Why stub only the fetch and nothing else: this repo has no
// `ANTHROPIC_API_KEY` configured (see .env / missions/20260909-ai-docs/
// tech-decisions.md — "Absent from .env as of 2026-09-09. The feature
// must degrade gracefully"), so a real model call is not possible in this
// environment. Scenarios 1-3 intercept the client's own `fetch("/api/ai/
// docs", ...)` call (lib/ai/use-doc-assistant.ts) and fulfil it with a
// hand-built NDJSON body using the EXACT event envelope
// app/api/ai/docs/route.ts emits (tech-decisions.md, verbatim):
//   {"t":"text","v":"..."}
//   {"t":"tool_start","id":"...","name":"...","args"?:"..."}
//   {"t":"tool_end","id":"...","summary":"...","detail"?:"..."}
//   {"t":"proposal","id":"...","kind":"doc_edit"|"doc_create","payload":{...}}
//   {"t":"usage","in":123,"out":456,"cached":789}
//   {"t":"done"}
// Everything downstream of that fetch — the NDJSON parser
// (lib/ai/use-doc-assistant.ts), tool card rendering
// (components/ai/tool-call-card.tsx), proposal card rendering + Accept's
// real server action (lib/actions/ai-proposals.ts, a REAL write to a REAL
// seeded doc row) — is exercised for real. Only the Anthropic call itself
// is stubbed; the accept/reject write paths are not.
//
// Scenario 4 (AS-071, "no key") needs NO stub at all: `hasApiKey()`
// (lib/ai/client.ts) is read server-side in
// app/(workspace)/w/[workspaceSlug]/layout.tsx and baked into the page as
// a real server-rendered prop — since this environment genuinely has no
// key configured, the composer is genuinely disabled without any mocking.
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link in
// the real browser -> capture the implicit-flow tokens from the redirect
// fragment -> inject them into the same `sb-<project-ref>-auth-token`
// cookie `@supabase/ssr`'s server client reads) is the exact technique
// tests/e2e/board-reorder.spec.ts, tests/e2e/subtask-ui.spec.ts and
// tests/e2e/checklist-ui.spec.ts already established — see any of those
// files' own comments for the full rationale; not re-explained line-by-
// line here.
//
// Covers:
//   - AS-103: open a doc -> open sidebar -> send a read-only question ->
//     a tool card appears -> assistant text streams in -> the document is
//     NOT mutated (verified against the DB row directly, not just the UI).
//   - AS-104: request an edit -> proposal card with a visible diff ->
//     Accept -> the new content is in the document (verified against the
//     DB row) -> reload -> still there, and the card shows accepted, not
//     pending.
//   - AS-066 / AS-010: proposal -> Reject -> zero writes -> the document
//     is unchanged after reload (verified against the DB row).
//   - AS-071: with `ANTHROPIC_API_KEY` unset, the sidebar renders and the
//     composer is disabled with one clear explanatory message.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
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
    "F022: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// F022: whether a real `ANTHROPIC_API_KEY` is present in this environment.
// As of this feature's own writing it is NOT (see file header) — scenarios
// 1-3 stub the model call regardless of this flag (that is the honest,
// reproducible mode this spec always runs in), but this flag additionally
// gates scenario 4's assumption ("composer IS disabled") since that
// assumption only holds while the key is genuinely absent.
const HAS_REAL_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("AI docs sidebar (F022: AS-103, AS-104, AS-066, AS-010, AS-071)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdDocIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let workspaceId: string;
  let projectId: string;
  let memberUserId: string;
  let memberEmail: string;

  async function seedDoc(title: string, content: string): Promise<string> {
    const { data, error } = await adminClient
      .from("docs")
      .insert({
        workspace_id: workspaceId,
        title,
        content,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Failed to seed doc "${title}": ${error?.message}`);
    }
    createdDocIds.push(data.id);
    return data.id;
  }

  async function getDocContent(docId: string): Promise<string> {
    const { data, error } = await adminClient
      .from("docs")
      .select("content")
      .eq("id", docId)
      .single();
    if (error || !data) {
      throw new Error(`Failed to read doc "${docId}": ${error?.message}`);
    }
    return data.content as string;
  }

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f022-ai-docs-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F022 AI Docs Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f022-e2e-member-${uniqueSuffix}@example.com`;
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
        name: `F022 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);
  });

  test.afterAll(async () => {
    for (const docId of createdDocIds) {
      await adminClient.from("docs").delete().eq("id", docId);
    }
    for (const pId of createdProjectIds) {
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
  // tests/e2e/checklist-ui.spec.ts — see that file's own comments for the
  // complete rationale.
  async function loginAndGoToDoc(page: Page, baseURL: string, docId: string) {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: memberEmail,
        options: { redirectTo: `${baseURL}/auth/callback` },
      });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Failed to generate magic link: ${linkErr?.message}`);
    }

    // F022 note (differs from tests/e2e/checklist-ui.spec.ts's assumption):
    // in THIS environment the Supabase project's configured Site URL is
    // the deployed production domain, not localhost, and
    // `options.redirectTo` above is not on that project's allowed
    // redirect-URL list — so Supabase's own redirect after verifying the
    // OTP lands on the production domain instead of failing back to
    // `/sign-in?error=auth_failed` on localhost. The implicit-flow session
    // tokens are still present in that URL's hash fragment regardless of
    // which domain served the redirect, so this reads them directly off
    // wherever `page.goto` actually landed rather than assuming a specific
    // local URL shape.
    await page.goto(linkData.properties.action_link);
    await page.waitForURL((url) => url.hash.includes("access_token="), {
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

    await page.goto(`${baseURL}/w/${workspaceSlug}/docs/${docId}`);
    await page.waitForURL(`**/w/${workspaceSlug}/docs/${docId}`, {
      timeout: 15_000,
    });
  }

  async function openSidebar(page: Page) {
    const toggle = page.getByTestId("assistant-sidebar-toggle");
    await toggle.click();
    await expect(page.getByTestId("assistant-sidebar")).toBeVisible();
  }

  /** Builds a raw NDJSON body from a list of already-shaped event objects. */
  function ndjson(events: Array<Record<string, unknown>>): string {
    return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  }

  /** Stubs the client's own POST to /api/ai/docs with a canned NDJSON
   * stream matching the exact envelope app/api/ai/docs/route.ts emits
   * (tech-decisions.md). No real Anthropic call is made — see file header. */
  async function stubModelRoute(page: Page, body: string) {
    await page.route("**/api/ai/docs", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body,
      });
    });
  }

  test("AS-103: read-only question renders a tool card and streamed text, and does not mutate the doc", async ({
    page,
    baseURL,
  }) => {
    const originalContent = "Original paragraph for the read-only e2e scenario.";
    const docId = await seedDoc("F022 Read-only doc", originalContent);

    await loginAndGoToDoc(page, baseURL!, docId);

    await stubModelRoute(
      page,
      ndjson([
        { t: "tool_start", id: "call_1", name: "search_docs", args: "{}" },
        {
          t: "tool_end",
          id: "call_1",
          summary: "Found 1 matching document",
          detail: "F022 Read-only doc",
        },
        { t: "text", v: "This document " },
        { t: "text", v: "looks complete to me." },
        { t: "usage", in: 100, out: 20, cached: 0 },
        { t: "done" },
      ]),
    );

    await openSidebar(page);

    await page.getByTestId("assistant-composer-input").fill("What's missing from this doc?");
    await page.getByTestId("assistant-composer-send").click();

    // Tool card appears (AS-063's rendering, exercised here for AS-103).
    await expect(page.getByTestId("tool-call-card")).toBeVisible();
    await expect(page.getByTestId("tool-call-card")).toContainText("search_docs");

    // Assistant text arrives.
    await expect(page.getByTestId("assistant-thread-assistant-turn")).toContainText(
      "This document looks complete to me.",
    );

    // No document mutation: DB row unchanged.
    const contentAfter = await getDocContent(docId);
    expect(contentAfter).toBe(originalContent);
  });

  test("AS-104: an edit proposal can be accepted, and the change persists across reload", async ({
    page,
    baseURL,
  }) => {
    const originalContent = "Original paragraph before edit.";
    const proposedContent = "Original paragraph before edit, now revised by the assistant.";
    const docId = await seedDoc("F022 Accept doc", originalContent);

    await loginAndGoToDoc(page, baseURL!, docId);

    await stubModelRoute(
      page,
      ndjson([
        {
          t: "proposal",
          id: "proposal_1",
          kind: "doc_edit",
          payload: {
            kind: "doc_edit",
            proposalId: "proposal_1",
            docId,
            docTitle: "F022 Accept doc",
            currentMarkdown: originalContent,
            proposedMarkdown: proposedContent,
            diff: [
              { type: "removed", value: `${originalContent}\n` },
              { type: "added", value: `${proposedContent}\n` },
            ],
          },
        },
        { t: "usage", in: 100, out: 20, cached: 0 },
        { t: "done" },
      ]),
    );

    await openSidebar(page);
    await page.getByTestId("assistant-composer-input").fill("Please revise this doc.");
    await page.getByTestId("assistant-composer-send").click();

    const card = page.getByTestId("proposal-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "pending");
    // Diff is visible.
    await expect(page.getByTestId("diff-view")).toBeVisible();
    await expect(page.getByTestId("diff-view")).toContainText(proposedContent);

    await page.getByTestId("proposal-card-accept").click();

    // Card collapses to accepted, not pending.
    await expect(card).toHaveAttribute("data-status", "accepted");

    // The real server action wrote the new content — verified against the
    // DB row directly (not just the client's own optimistic state).
    await expect(async () => {
      const content = await getDocContent(docId);
      expect(content).toBe(proposedContent);
    }).toPass({ timeout: 10_000 });

    // Reload: still there, and the card still shows accepted.
    await page.reload();
    await page.waitForURL(`**/w/${workspaceSlug}/docs/${docId}`, {
      timeout: 15_000,
    });
    const contentAfterReload = await getDocContent(docId);
    expect(contentAfterReload).toBe(proposedContent);
  });

  test("AS-066 / AS-010: rejecting a proposal makes zero writes and the doc is unchanged after reload", async ({
    page,
    baseURL,
  }) => {
    const originalContent = "Original paragraph for the reject e2e scenario.";
    const proposedContent = "This change should never be applied.";
    const docId = await seedDoc("F022 Reject doc", originalContent);

    await loginAndGoToDoc(page, baseURL!, docId);

    await stubModelRoute(
      page,
      ndjson([
        {
          t: "proposal",
          id: "proposal_2",
          kind: "doc_edit",
          payload: {
            kind: "doc_edit",
            proposalId: "proposal_2",
            docId,
            docTitle: "F022 Reject doc",
            currentMarkdown: originalContent,
            proposedMarkdown: proposedContent,
            diff: [
              { type: "removed", value: `${originalContent}\n` },
              { type: "added", value: `${proposedContent}\n` },
            ],
          },
        },
        { t: "usage", in: 100, out: 20, cached: 0 },
        { t: "done" },
      ]),
    );

    await openSidebar(page);
    await page.getByTestId("assistant-composer-input").fill("Please revise this doc.");
    await page.getByTestId("assistant-composer-send").click();

    const card = page.getByTestId("proposal-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "pending");

    await page.getByTestId("proposal-card-reject").click();
    await expect(card).toHaveAttribute("data-status", "rejected");

    // AS-010: zero writes. DB row unchanged immediately...
    const contentImmediately = await getDocContent(docId);
    expect(contentImmediately).toBe(originalContent);

    // ...and after a reload.
    await page.reload();
    await page.waitForURL(`**/w/${workspaceSlug}/docs/${docId}`, {
      timeout: 15_000,
    });
    const contentAfterReload = await getDocContent(docId);
    expect(contentAfterReload).toBe(originalContent);
  });

  test("AS-071: with no ANTHROPIC_API_KEY, the sidebar renders and the composer is disabled", async ({
    page,
    baseURL,
  }) => {
    test.skip(
      HAS_REAL_API_KEY,
      "ANTHROPIC_API_KEY is set in this environment; AS-071's premise (key absent) does not hold here.",
    );

    const docId = await seedDoc(
      "F022 No-key doc",
      "Content for the no-API-key e2e scenario.",
    );

    await loginAndGoToDoc(page, baseURL!, docId);
    await openSidebar(page);

    // The one clear explanatory message, per components/ai/assistant-
    // composer.tsx and the empty state's `hasApiKey` branch
    // (components/ai/assistant-sidebar.tsx).
    await expect(page.getByTestId("assistant-composer-no-api-key")).toBeVisible();

    // The composer's own real input, if rendered at all, must be
    // disabled — no way to submit a request that can only fail.
    const composer = page.getByTestId("assistant-composer");
    if (await composer.count()) {
      await expect(page.getByTestId("assistant-composer-input")).toBeDisabled();
    }

    // No suggestion chips either (would optimistically send with no key
    // to answer it — see assistant-sidebar.tsx's own B3 comment).
    await expect(
      page.getByTestId("assistant-sidebar-suggestions"),
    ).toHaveCount(0);
  });
});
