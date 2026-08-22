// Integration test for F170 (AS-310), run against the real linked
// Supabase project — mirrors the loadDotEnv/admin-client pattern
// established by tests/integration/tasks-schema.test.ts.
//
// AS-310: existing plain-text descriptions render unchanged after
// migration. Since the rich-text renderer doesn't ship until F171, this
// verifies the thing F171 will depend on: the backfilled/derived
// description_json document, when its plain text is extracted (walking
// the exact Tiptap doc/paragraph/text node shape), must exactly
// reproduce the original plain-text description with no loss or
// mangling — including special characters, embedded newlines, empty
// string, and null.

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Minimal walker mirroring Tiptap's own JSON-to-text extraction for the
// document shapes this migration produces: a `doc` with zero or one
// `paragraph` children, each with zero or one `text` leaf nodes. This is
// what a real Tiptap JSONContent -> plain-text conversion returns for
// these specific shapes (not a re-implementation of a general Tiptap
// schema walker).
type TiptapDoc = {
  type: string;
  content?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
};

function extractPlainText(doc: TiptapDoc): string {
  if (!doc || doc.type !== "doc" || !doc.content || doc.content.length === 0) {
    return "";
  }
  return doc.content
    .map((block) =>
      (block.content ?? [])
        .map((node) => (node.type === "text" ? (node.text ?? "") : ""))
        .join(""),
    )
    .join("\n");
}

describe.skipIf(!haveAdminCreds)(
  "task description JSON migration + backfill (F170, AS-310)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let authorId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F170 Test Workspace",
          slug: `f170-desc-json-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const authorEmail = `f170-author-${uniqueSuffix}@example.com`;
      const { data: authorAuth, error: authorAuthErr } =
        await adminClient.auth.admin.createUser({
          email: authorEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authorAuthErr || !authorAuth.user) {
        throw new Error(
          `Failed to create author user: ${authorAuthErr?.message}`,
        );
      }
      authorId = authorAuth.user.id;
      createdUserIds.push(authorId);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F170 Test Project ${uniqueSuffix}`,
          created_by: authorId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const projId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", projId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    const cases: Array<{ label: string; description: string | null }> = [
      { label: "plain text", description: "Ship the release notes" },
      {
        label: "special characters",
        description: `Fix "quoted" & <tags> — 100% done? Yes/No; café résumé`,
      },
      {
        label: "multi-line text",
        description: "Line one\nLine two\nLine three",
      },
      { label: "empty string", description: "" },
      { label: "null", description: null },
    ];

    for (const { label, description } of cases) {
      it(`AS-310: backfilled description_json round-trips "${label}" description unchanged`, async () => {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: `F170 round-trip case: ${label}`,
            author_id: authorId,
            description,
          })
          .select("id, description, description_json, description_text")
          .single();

        expect(error).toBeNull();
        expect(data).toBeTruthy();
        if (!data) return;
        createdTaskIds.push(data.id);

        // description_text is the raw existing text (empty string for null).
        expect(data.description_text).toBe(description ?? "");

        // description_json, once its plain text is extracted the way
        // F171's renderer will do it, must exactly equal the original
        // description with no loss or mangling.
        const doc = data.description_json as unknown as TiptapDoc;
        expect(extractPlainText(doc)).toBe(description ?? "");

        if (!description) {
          // Empty/null description backfills to an empty Tiptap doc
          // (no paragraph child), matching Tiptap's own empty-doc shape.
          expect(doc.type).toBe("doc");
          expect(doc.content ?? []).toHaveLength(0);
        } else {
          expect(doc).toEqual({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: description }],
              },
            ],
          });
        }
      });
    }

    it("AS-310: legacy description column is left unchanged by the migration/trigger", async () => {
      const description = "Legacy column must not be mutated";
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F170 legacy column preserved",
          author_id: authorId,
          description,
        })
        .select("id, description")
        .single();

      expect(error).toBeNull();
      if (!data) return;
      createdTaskIds.push(data.id);
      expect(data.description).toBe(description);
    });

    it("search_vector still matches on description content via description_text (no FTS regression)", async () => {
      const uniqueToken = `zzqjw${Date.now()}`;
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F170 FTS regression check",
          author_id: authorId,
          description: `Contains the unique token ${uniqueToken} in its body`,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (!data) return;
      createdTaskIds.push(data.id);

      const { data: matches, error: searchErr } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", data.id)
        .textSearch("search_vector", uniqueToken, {
          type: "plain",
          config: "english",
        });

      expect(searchErr).toBeNull();
      expect(matches).toHaveLength(1);
    });
  },
);
