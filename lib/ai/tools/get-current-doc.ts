// F003: the "read one document" tool. This is the first real AI tool in the
// codebase and its shape is the pattern every later tool (F004+) copies:
//
//   1. A Zod `inputSchema` for the tool's arguments (validated before any
//      database call, so a malformed argument never reaches Supabase).
//   2. A `run(input)` function that returns `Promise<ToolResult<T>>` from
//      lib/ai/tools/types.ts — never throws, never returns a bare object.
//   3. The RLS-respecting `createClient()` from `lib/supabase/server` —
//      **never** a service-role client. Per tech-decisions.md's
//      Authorization section, the AI layer gets no service-role key; RLS is
//      the only enforcement boundary, same as every Server Action in
//      lib/actions/docs.ts.
//   4. Not-found and RLS-invisible collapse to the exact same `ToolEmpty`
//      shape with the exact same `message` (AS-008) — Supabase's
//      `.select().eq("id", ...).maybeSingle()` already returns `null` for
//      both cases indistinguishably, so there is nothing to special-case;
//      that's precisely why this tool doesn't attempt to detect "does this
//      row exist in some other workspace" before querying.
//   5. A `name`/`description`/`inputSchema`/`run` export object matching
//      the shape F006's tool registry will import.
//
// F027 (fixes M1-SCRUTINY.md M1c, AS-023/AS-024/AS-021): `run` now takes a
// second, non-model-controlled `workspaceId` argument threaded down from
// the route via lib/ai/docs-agent.ts's per-request tool wiring (never part
// of the Zod `inputSchema` a model can influence). RLS already makes a doc
// in a workspace the caller isn't a member of invisible, but a caller who
// is an ACTIVE member of BOTH their current workspace and some other one
// would otherwise be able to read the other workspace's doc through this
// tool — RLS has nothing to say about "current" vs. "any" workspace, only
// about membership. The extra check below is that defence in depth, mirror
// of `lib/queries/docs.ts:163`'s `.eq("workspace_id", workspaceId)`. A doc
// that fails the check returns the exact same `ToolEmpty` shape/reason/
// message as a genuinely nonexistent doc — collapsing this new case into
// the existing AS-008/AS-021 not-found path rather than inventing a new
// one, so no new observable difference is introduced.

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { empty, err, ok, type ToolResult } from "@/lib/ai/tools/types";

// Cap the markdown returned to the model so a very large document can't
// flood its context window. 40_000 characters (~10k tokens) is generous for
// a single doc while staying well inside typical context budgets.
const MAX_MARKDOWN_CHARS = 40_000;

// Generic empty-state message shared by both the "no such row" and the
// "row exists but RLS hides it" cases. Do not let the wording differ
// between `reason: "not_found"` and `reason: "not_visible"` — see
// ToolEmpty's doc comment in lib/ai/tools/types.ts for why (AS-008).
const NOT_FOUND_MESSAGE = "No matching document found.";

export const getCurrentDocInputSchema = z.object({
  docId: z.string().uuid(),
});

export type GetCurrentDocInput = z.infer<typeof getCurrentDocInputSchema>;

export type GetCurrentDocData = {
  docId: string;
  title: string;
  markdown: string;
  folderName: string | null;
  clientVisible: boolean;
  wordCount: number;
  truncated: boolean;
};

function countWords(markdown: string): number {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export async function run(
  input: GetCurrentDocInput,
  workspaceId: string,
): Promise<ToolResult<GetCurrentDocData>> {
  const parsed = getCurrentDocInputSchema.safeParse(input);
  if (!parsed.success) {
    return err("invalid_input", "That doesn't look like a valid document id.");
  }

  const supabase = await createClient();

  // A single row lookup by primary key, scoped by RLS
  // (`docs_select_active_members`, 20260904010000_docs_system.sql) plus the
  // `workspace_id` selected below and checked in code (F027) — RLS alone
  // only proves "some workspace this caller is an active member of", not
  // "the caller's CURRENT workspace" (AS-023/AS-024's actual wording), so a
  // caller active in two workspaces needs the extra check. Not-found and
  // not-visible-to-any-workspace still collapse into the same query result
  // (`data: null`) exactly as before.
  const { data, error } = await supabase
    .from("docs")
    .select("id, title, content, client_visible, workspace_id, doc_folders(name)")
    .eq("id", parsed.data.docId)
    .maybeSingle();

  if (error) {
    return err("doc_fetch_failed", "Something went wrong reading that document.");
  }

  if (!data || data.workspace_id !== workspaceId) {
    // Same shape/reason/message whether the row doesn't exist, RLS hides
    // it, or it belongs to a different workspace the caller happens to
    // also be a member of (AS-008/AS-021) — never let the wording tell
    // these cases apart.
    return empty("not_found", NOT_FOUND_MESSAGE);
  }

  const markdown = data.content ?? "";
  const truncated = markdown.length > MAX_MARKDOWN_CHARS;
  const folder = data.doc_folders as { name: string } | { name: string }[] | null;
  const folderName = Array.isArray(folder) ? (folder[0]?.name ?? null) : (folder?.name ?? null);

  return ok({
    docId: data.id,
    title: data.title,
    markdown: truncated ? markdown.slice(0, MAX_MARKDOWN_CHARS) : markdown,
    folderName,
    clientVisible: data.client_visible ?? false,
    wordCount: countWords(markdown),
    truncated,
  });
}

export const getCurrentDocTool = {
  name: "get_current_doc",
  description:
    "Read one document's title, markdown content, folder name, and client-visibility flag. Returns an empty result if the document does not exist or is not visible to the caller's workspace.",
  inputSchema: getCurrentDocInputSchema,
  run,
};
