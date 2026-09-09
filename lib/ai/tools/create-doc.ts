// F017: the "draft a brand-new document" tool. Same pattern F003-F005/F014
// already established:
//
//   1. A Zod `inputSchema` validated before any database call.
//   2. A `run(input, workspaceId)` function that returns
//      `Promise<ToolResult<T>>` from lib/ai/tools/types.ts — never throws,
//      never returns a bare object.
//   3. `workspaceId` is closed over per-request by F006's tool wiring
//      (lib/ai/docs-agent.ts's `forRunner`) — it is NEVER part of this
//      tool's Zod `inputSchema`, so a model can never supply or spoof it.
//   4. This tool NEVER calls `.insert(`/`.update(`/`.delete(`/`.upsert(`/
//      `.rpc(` on anything (AS-003, covered by
//      lib/ai/tools/__tests__/no-writes.test.ts, whose AST walk includes
//      this file). It only ever returns a `DocCreateProposal`
//      (lib/ai/tools/types.ts, F002) for the user to review — the actual
//      write happens later, in `lib/actions/ai-proposals.ts`'s
//      `applyDocCreateProposal`, only after the user clicks Accept.
//
// Folder validation (AS-002, AS-028's "cross-workspace isolation" case):
// when the model supplies a `folderId`, it is checked against the
// RLS-respecting client AND an explicit `.eq("workspace_id", workspaceId)`
// filter — the same defence-in-depth shape get_current_doc (F003/F027)
// uses — before it is ever echoed back inside the proposal. A folder that
// doesn't exist, isn't visible to this caller, or belongs to a different
// workspace all collapse into the identical `ToolEmpty` shape/message
// (never distinguishing "doesn't exist" from "not yours to see"), so
// nothing about another workspace's data is ever leaked through this tool.
// `folderId: null` (the model choosing "no specific folder") skips this
// read entirely — there is nothing to validate.

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { empty, err, ok, type ToolResult } from "@/lib/ai/tools/types";
import type { DocCreateProposal } from "@/lib/ai/tools/types";

const NOT_FOUND_MESSAGE = "No matching folder found.";

export const createDocInputSchema = z.object({
  title: z.string().trim().min(1),
  markdown: z.string(),
  folderId: z.string().uuid().nullable(),
  templateName: z.string().trim().min(1).nullable(),
});

export type CreateDocInput = z.infer<typeof createDocInputSchema>;

export async function run(
  input: CreateDocInput,
  workspaceId: string,
): Promise<ToolResult<DocCreateProposal>> {
  const parsed = createDocInputSchema.safeParse(input);
  if (!parsed.success) {
    return err("invalid_input", "That doesn't look like a valid document draft.");
  }

  const { title, markdown, folderId, templateName } = parsed.data;

  if (folderId) {
    const supabase = await createClient();

    // Scoped by RLS (doc_folders' own select policy) plus an explicit
    // `.eq("workspace_id", workspaceId)` check (same shape as
    // get_current_doc's F027 defence in depth) — RLS alone only proves
    // membership in *some* workspace the folder belongs to, not the
    // caller's CURRENT one.
    const { data, error } = await supabase
      .from("doc_folders")
      .select("id, workspace_id")
      .eq("id", folderId)
      .maybeSingle();

    if (error) {
      return err("folder_fetch_failed", "Something went wrong checking that folder.");
    }

    if (!data || data.workspace_id !== workspaceId) {
      // Same generic message whether the folder doesn't exist, is hidden
      // by RLS, or belongs to a different workspace the caller happens to
      // also be a member of — never let the wording tell these cases
      // apart (same convention as get_current_doc's AS-008/AS-021 path).
      return empty("not_found", NOT_FOUND_MESSAGE);
    }
  }

  const proposal: DocCreateProposal = {
    kind: "doc_create",
    proposalId: crypto.randomUUID(),
    title,
    markdown,
    folderId,
    templateName,
  };

  return ok(proposal);
}

export const createDocTool = {
  name: "create_doc",
  description:
    "Draft a brand-new document (title, full markdown content, an optional target folder, and an optional template name it was drafted from) for the user to review. Never creates the document itself — returns a proposal only. Returns an empty result if a supplied folder does not exist or is not visible to the caller's workspace.",
  inputSchema: createDocInputSchema,
  run,
};
