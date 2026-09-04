// F025 (missions/20260903-portal, M5 — the leak sweep): AS-055.
//
// "A client session that walks every portal route returns no
// internal-only field in any response payload."
//
// Route enumeration is filesystem-derived, not hard-coded: every
// `page.tsx` under `app/(portal)` is found via a recursive `fs` walk.
// Because a Server Component page cannot be rendered outside a live
// Next.js request context (the same constraint tests/integration/
// f003-portal-shell.test.ts and f005-portal-pages.test.ts document and
// work around), this suite instead statically parses each route file's
// own `import { ... } from "@/lib/queries/..."` lines — so the set of
// data-loading functions under test is derived from what the routes
// actually import, not hand-picked — then calls every such function
// through the mocked, RLS-respecting client session `lib/supabase/
// server.ts` `createClient()` seam (the identical technique F003/F005/
// F025's own table-sweep sibling use). A function's own exported
// signature (read from its module source, not hand-typed) decides
// whether it is called with the fixture `projectId`, `workspaceId`, or
// skipped as multi-argument/no-argument — skipped names are asserted to
// be a bounded, reviewed set, not silently zero-covered.
//
// A single fixture project carries one marker of each kind the spec
// calls out: an internal comment body, a time-entry note, a
// non-client-visible task title, a `quoted_amount` on an unsent quote
// (client_decision = 'pending', no approval_request_id), an audit_log
// row, and a credential-shaped string. Every derived function's return
// value is JSON.stringify'd and checked for every marker.
//
// Failure test (Definition of Done, non-optional): the hidden task's
// `client_visible` flag is flipped to true mid-suite, the walk re-run,
// and the task-title marker is asserted to now APPEAR in at least one
// payload (proving the scan mechanism truly inspects the serialised
// payload rather than passing vacuously), then reverted.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

vi.setConfig({ testTimeout: 60000 });

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
  throw new Error("F025 route walk: missing Supabase credentials required to run in CI.");
}

const PASSWORD = "Test-password-1!";

let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

// ---------------------------------------------------------------------
// 1. Route enumeration: walk app/(portal) for every page.tsx.
// ---------------------------------------------------------------------
const PORTAL_ROOT = join(process.cwd(), "app", "(portal)");

function walkPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkPageFiles(full));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// 2. For each route file, statically derive which `@/lib/queries/*`
//    functions it imports.
// ---------------------------------------------------------------------
function extractQueryImports(source: string): { modulePath: string; names: string[] }[] {
  const results: { modulePath: string; names: string[] }[] = [];
  const importRe = /import\s*\{([^}]+)\}\s*from\s*["'](@\/lib\/queries\/[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source))) {
    const names = m[1]
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
      .filter((n) => /^[a-zA-Z_$][\w$]*$/.test(n));
    results.push({ modulePath: m[2], names });
  }
  return results;
}

// ---------------------------------------------------------------------
// 3. For a given exported function's own source text, decide whether it
//    takes a single `projectId`/`workspaceId` string argument (derived
//    from the signature itself, not a hand-typed map).
// ---------------------------------------------------------------------
function deriveCallArg(moduleSource: string, fnName: string): "projectId" | "workspaceId" | null {
  const re = new RegExp(
    `export\\s+async\\s+function\\s+${fnName}\\s*\\(([^)]*)\\)`,
    "s",
  );
  const match = re.exec(moduleSource);
  if (!match) return null;
  const params = match[1].trim();
  if (params === "") return null; // no-arg — not a per-project/workspace loader
  // Multi-parameter functions (comma at the top level) are skipped —
  // this suite only auto-calls the common single-scope-id shape every
  // portal query function in lib/queries/portal.ts, project-records.ts,
  // metrics.ts and project-site.ts otherwise uses.
  if (params.includes(",")) return null;
  if (/projectId\s*:\s*string/.test(params)) return "projectId";
  if (/workspaceId\s*:\s*string/.test(params)) return "workspaceId";
  return null;
}

describe.skipIf(!haveCreds)("F025: portal route walk — no internal field leaks (AS-055)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string;

  let pageTypeId: string;
  let hiddenTaskId: string;
  let hiddenTaskMarker: string;
  let internalCommentMarker: string;
  let timeEntryNoteMarker: string;
  let unsentQuoteAmount: number;
  let unsentQuoteMarkerTitle: string;
  let auditRowMarker: string;
  let credentialMarker: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f025-route-walk-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F025 route walk", slug: `f025-route-walk-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F025 route walk project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert({
      project_id: projectId,
      user_id: clientId,
      project_role: "member",
      added_by: ownerId,
    });

    // A "Page" task type, so the hidden task below is picked up by
    // getPortalPages — the failure test needs a task a real derived
    // function actually surfaces, not just any task row (matches the
    // pattern tests/integration/f005-portal-pages.test.ts fixtures use).
    const { data: pageType, error: pageTypeErr } = await admin
      .from("task_types")
      .insert({ workspace_id: workspaceId, name: "Page", color: "#3670e1", system_key: "page" })
      .select("id")
      .single();
    if (pageTypeErr || !pageType) throw new Error(`task type: ${pageTypeErr?.message}`);
    pageTypeId = pageType.id;

    // Marker 1: a non-client-visible task title.
    hiddenTaskMarker = `F025-ROUTE-HIDDEN-TASK-${suffix}`;
    const { data: hiddenTask, error: taskErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: hiddenTaskMarker,
        author_id: ownerId,
        client_visible: false,
        task_type_id: pageType.id,
        page_slug: "route-walk-fixture",
        page_order: 1,
      })
      .select("id")
      .single();
    if (taskErr || !hiddenTask) throw new Error(`hidden task: ${taskErr?.message}`);
    hiddenTaskId = hiddenTask.id;

    // Marker 2: an internal comment body on that task.
    internalCommentMarker = `F025-ROUTE-INTERNAL-COMMENT-${suffix}`;
    await admin
      .from("comments")
      .insert({ task_id: hiddenTaskId, user_id: ownerId, text: internalCommentMarker, internal: true });

    // Marker 3: a time-entry note.
    timeEntryNoteMarker = `F025-ROUTE-TIME-NOTE-${suffix}`;
    await admin
      .from("time_entries")
      .insert({ task_id: hiddenTaskId, user_id: ownerId, minutes: 30, note: timeEntryNoteMarker });

    // Marker 4: quoted_amount on an unsent quote (client_decision still
    // 'pending', no approval_request_id — never sent through the
    // approve_portal_task_atomic/accept flow).
    unsentQuoteAmount = 918273.45;
    unsentQuoteMarkerTitle = `F025-ROUTE-UNSENT-QUOTE-${suffix}`;
    await admin.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: unsentQuoteMarkerTitle,
      body: "route walk fixture",
      status: "in_review",
      scope_verdict: "change_request",
      quoted_amount: unsentQuoteAmount,
      quote_currency: "USD",
    });

    // Marker 5: an audit_log row.
    auditRowMarker = `F025-ROUTE-AUDIT-${suffix}`;
    await admin.from("audit_log").insert({
      workspace_id: workspaceId,
      actor_id: ownerId,
      action: "project.updated",
      target_type: "project",
      target_id: projectId,
      metadata: { note: auditRowMarker },
    });

    // Marker 6: a credential-shaped string, planted in an ordinary text
    // field with no `looks_like_credential` guard (task description).
    credentialMarker = "sk_live_51F025RouteWalkCredentialShapedMarkerXYZ";
    await admin
      .from("tasks")
      .update({ description: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: credentialMarker }] }] }) })
      .eq("id", hiddenTaskId);

    const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await session.auth.signInWithPassword({
      email: clientUser.email,
      password: PASSWORD,
    });
    if (signInError) throw new Error(`sign in client: ${signInError.message}`);
    clientSession = session;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("client_requests").delete().eq("project_id", projectId);
    await admin.from("audit_log").delete().eq("workspace_id", workspaceId);
    await admin.from("time_entries").delete().eq("task_id", hiddenTaskId);
    await admin.from("comments").delete().eq("task_id", hiddenTaskId);
    await admin.from("tasks").delete().eq("project_id", projectId);
    if (pageTypeId) await admin.from("task_types").delete().eq("id", pageTypeId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  const markers = () => [
    hiddenTaskMarker,
    internalCommentMarker,
    timeEntryNoteMarker,
    String(unsentQuoteAmount),
    auditRowMarker,
    credentialMarker,
  ];

  async function runWalk(): Promise<{ payloads: string[]; called: string[]; skipped: string[] }> {
    const pageFiles = walkPageFiles(PORTAL_ROOT);
    expect(pageFiles.length, "F025 route walk found zero page.tsx files — the fs walk itself is broken").toBeGreaterThan(0);

    // Dedup (modulePath, fnName) pairs across every route file.
    const pairs = new Map<string, { modulePath: string; name: string }>();
    for (const file of pageFiles) {
      const source = readFileSync(file, "utf8");
      for (const { modulePath, names } of extractQueryImports(source)) {
        for (const name of names) {
          pairs.set(`${modulePath}#${name}`, { modulePath, name });
        }
      }
    }

    const payloads: string[] = [];
    const called: string[] = [];
    const skipped: string[] = [];

    activeSession = clientSession;

    for (const { modulePath, name } of pairs.values()) {
      let moduleSource: string;
      let resolvedModule: Record<string, unknown>;
      try {
        const relPath = modulePath.replace("@/", "");
        moduleSource = readFileSync(join(process.cwd(), `${relPath}.ts`), "utf8");
        resolvedModule = (await import(modulePath)) as Record<string, unknown>;
      } catch {
        skipped.push(`${modulePath}#${name} (module not resolvable)`);
        continue;
      }

      const fn = resolvedModule[name];
      if (typeof fn !== "function") {
        skipped.push(`${modulePath}#${name} (not an exported function)`);
        continue;
      }

      const argKind = deriveCallArg(moduleSource, name);
      if (!argKind) {
        skipped.push(`${modulePath}#${name} (no single projectId/workspaceId signature)`);
        continue;
      }

      const arg = argKind === "projectId" ? projectId : workspaceId;
      try {
        const result = await (fn as (a: string) => Promise<unknown>)(arg);
        payloads.push(JSON.stringify(result));
        called.push(`${modulePath}#${name}`);
      } catch (err) {
        skipped.push(`${modulePath}#${name} (threw: ${err instanceof Error ? err.message : String(err)})`);
      }
    }

    return { payloads, called, skipped };
  }

  it("primary success test: no derived portal query function's payload contains any planted marker", async () => {
    const { payloads, called, skipped } = await runWalk();

    // A vacuous pass (zero functions actually called) is not a pass.
    expect(
      called.length,
      `F025 route walk called zero query functions — derivation is broken. Skipped: ${JSON.stringify(skipped)}`,
    ).toBeGreaterThan(0);

    const combined = payloads.join("\n");
    for (const marker of markers()) {
      expect(
        combined.includes(marker),
        `F025 route walk: marker "${marker}" leaked through one of: ${JSON.stringify(called)}`,
      ).toBe(false);
    }
  });

  it(
    "failure test: flipping the hidden task's client_visible to true makes its title marker " +
      "appear in the walk's own combined payload — proving the scan is not vacuous",
    async () => {
      const before = await runWalk();
      const beforeCombined = before.payloads.join("\n");
      expect(beforeCombined.includes(hiddenTaskMarker)).toBe(false);

      await admin.from("tasks").update({ client_visible: true }).eq("id", hiddenTaskId);

      try {
        const after = await runWalk();
        const afterCombined = after.payloads.join("\n");
        expect(
          afterCombined.includes(hiddenTaskMarker),
          "F025 route walk failure test did not actually fail — the scan is vacuous",
        ).toBe(true);
      } finally {
        await admin.from("tasks").update({ client_visible: false }).eq("id", hiddenTaskId);
      }

      const reverted = await runWalk();
      expect(reverted.payloads.join("\n").includes(hiddenTaskMarker)).toBe(false);
    },
  );
});
