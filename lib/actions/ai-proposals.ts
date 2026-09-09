"use server";

// F016: the single, narrow, auditable write path for an accepted AI doc-
// edit proposal. This is an ordinary server action — it is NOT reachable
// from a tool (lib/ai/tools/__tests__/no-writes.test.ts's AST walk starts
// at lib/ai/tools/**, lib/ai/docs-agent.ts, and app/api/ai/docs/route.ts;
// none of those import this file, and this file never imports anything
// under lib/ai/tools/), so AS-003 stays true: the AI layer itself can
// never reach a write, only a human's click on Accept can.
//
// Writes go through lib/actions/docs.ts's existing `updateDoc` — the same
// RLS, `revalidatePath`, and audit behaviour a human's own edit gets.
// This file does NOT open a second write path (no direct
// `.from("docs").update(...)` here) and does NOT use a Supabase client for
// anything but the READ needed for the staleness check below.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createDoc, updateDoc } from "@/lib/actions/docs";

export type ApplyDocEditProposalInput = {
  docId: string;
  /**
   * The exact markdown the proposal's diff was computed against
   * (`DocEditProposal.currentMarkdown`, lib/ai/tools/types.ts). Compared
   * against the document's live content below; a mismatch means the
   * document changed since the proposal was generated, and the proposal
   * must be regenerated rather than applied on top of a stale base.
   */
  expectedCurrentMarkdown: string;
  proposedMarkdown: string;
};

export type ApplyDocEditProposalResult = { ok: true } | { ok: false; error: string };

const STALE_ERROR_MESSAGE =
  "The document changed since this proposal was made. Please ask the assistant to revise it.";

/**
 * Normalises markdown for the staleness comparison only (never used for
 * what actually gets written — `proposedMarkdown` is always written
 * verbatim). Trims trailing whitespace per line and normalises line
 * endings to `\n`, so an invisible difference (a stray trailing space, or
 * a CRLF a client-side paste introduced) does not produce a spurious
 * rejection of an otherwise-unchanged document.
 */
export function normalizeForStaleCheck(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

/**
 * Applies an accepted `propose_doc_edit` proposal. Re-reads the document's
 * live content and compares it (normalised) against
 * `expectedCurrentMarkdown` before writing anything — if it has changed,
 * this returns an error and performs no write, rather than silently
 * clobbering someone else's edit (AS-009's "exactly the rows the diff
 * showed and nothing else" only holds if the base the diff was computed
 * against still matches reality).
 *
 * Callers (ProposalCard) are responsible for the editor-state side of the
 * race — cancelling the editor's own pending autosave and comparing
 * against its LIVE in-memory markdown, not just this function's own
 * re-read, since the editor's autosave may not have persisted the very
 * latest keystrokes yet. See components/docs/markdown-editor.tsx and
 * lib/ai/doc-editor-bridge.ts.
 */
export async function applyDocEditProposal(
  input: ApplyDocEditProposalInput,
): Promise<ApplyDocEditProposalResult> {
  const { docId, expectedCurrentMarkdown, proposedMarkdown } = input;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to apply this change." };
  }

  const { data, error } = await supabase
    .from("docs")
    .select("title, content")
    .eq("id", docId)
    .maybeSingle();

  if (error) {
    logger.error("applyDocEditProposal: read failed", { error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  if (!data) {
    // Not found or not visible (RLS) — same generic phrasing convention
    // as lib/ai/tools/types.ts's ToolEmpty: never distinguish the two.
    return { ok: false, error: "That document could not be found." };
  }

  if (normalizeForStaleCheck(data.content ?? "") !== normalizeForStaleCheck(expectedCurrentMarkdown)) {
    return { ok: false, error: STALE_ERROR_MESSAGE };
  }

  const result = await updateDoc(docId, data.title, proposedMarkdown);
  if (result.error) {
    return { ok: false, error: result.error };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------
// F017: apply an accepted `create_doc` proposal.
// ---------------------------------------------------------------------

export type ApplyDocCreateProposalInput = {
  workspaceId: string;
  title: string;
  markdown: string;
  folderId: string | null;
};

/**
 * Returned shape matches `createDoc`'s own convention (lib/actions/
 * docs.ts) exactly — `{ id }` on success, `{ error }` on failure — rather
 * than the `{ ok: true } | { ok: false; error }` shape
 * `applyDocEditProposal` uses above. Per this feature's spec: the caller
 * (ProposalCard) needs the new doc's id to decide navigation itself; it
 * never navigates server-side.
 */
export type ApplyDocCreateProposalResult = { id: string } | { error: string };

/**
 * Applies an accepted `create_doc` proposal (lib/ai/tools/create-doc.ts).
 * Two ordinary writes through lib/actions/docs.ts's EXISTING actions — no
 * new write path is opened here, same invariant `applyDocEditProposal`
 * keeps above:
 *
 *   1. `createDoc(workspaceId, folderId, projectId)` — `createDoc`'s own
 *      signature has no title/content parameters (it always creates an
 *      "Untitled"/"" row so the editor page always has a real row to load
 *      into, per its own header comment), so the AI-drafted title and
 *      markdown are applied as a second, immediate write.
 *   2. `updateDoc(id, title, markdown)` — the SAME write path a human's
 *      own autosave uses (F016 reuses it identically for edit proposals).
 *
 * `projectId` is always `null` here: this feature's Touches does not
 * include threading the currently-open project's id down through
 * AssistantSidebar/ProposalCard (the assistant sidebar mounts at the
 * workspace layout level, not scoped to a project route — see
 * components/ai/assistant-sidebar.tsx's own header comment on why
 * `workspaceId` is its only route-derived id today). A `null` projectId
 * places the new doc at the workspace's Docs root, the exact same target
 * `components/docs/new-doc-button.tsx` and `docs-sidebar.tsx` use for
 * their own "New doc" actions when invoked outside a project route — this
 * is an existing, supported doc location, never a silent
 * workspace-root-of-something-else.
 *
 * `client_visible` is never set by either write here — the `docs` table
 * defaults it to `false` at the schema level (`client_role_and_task_
 * client_visibility.sql`), so an AI-drafted document is client-invisible
 * by construction, with no code path in this action able to override it.
 *
 * Two hardening measures fix the orphan-row bug scrutiny flagged
 * (M3-SCRUTINY.md BLOCKER-2):
 *
 *   1. `title` is validated (`.trim()` non-empty) BEFORE `createDoc` is
 *      ever called — `updateDoc` already rejects an empty title
 *      (docs.ts:235-238), so validating first means the empty
 *      ("Untitled", "") row is never created for a request that was
 *      always going to fail step 2.
 *   2. If `updateDoc` still fails for some other reason (network,
 *      RLS, etc.) after `createDoc` succeeded, the just-created row is
 *      deleted here (direct Supabase access — this file is a server
 *      action, not a tool under lib/ai/tools/**, so AS-003's
 *      no-writes-from-the-AI-layer guard does not apply to it) so a
 *      retry cannot leave a second orphan behind.
 */
export async function applyDocCreateProposal(
  input: ApplyDocCreateProposalInput,
): Promise<ApplyDocCreateProposalResult> {
  const { workspaceId, title, markdown, folderId } = input;

  if (!title.trim()) {
    return { error: "Title can't be empty." };
  }

  const created = await createDoc(workspaceId, folderId, null);
  if ("error" in created) {
    return { error: created.error };
  }

  const updated = await updateDoc(created.id, title, markdown);
  if (updated.error) {
    // Clean up the orphaned stub row so a retry cannot double-create.
    const supabase = await createClient();
    const { error: deleteError } = await supabase
      .from("docs")
      .delete()
      .eq("id", created.id);
    if (deleteError) {
      logger.error("applyDocCreateProposal: orphan cleanup failed", {
        error: deleteError,
        docId: created.id,
      });
    }
    return { error: updated.error };
  }

  return { id: created.id };
}
