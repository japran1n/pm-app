// Shared vocabulary every AI docs tool returns. The route handler and the
// chat UI consume `ToolResult<T>` uniformly and never special-case which
// tool produced it — this file is the single contract that makes that
// possible. Pure types + tiny constructor helpers only: no I/O, no network,
// no database, no React. Safe to import from either a server or a client
// module (nothing here is server-only).

/** A tool call that produced data successfully. */
export type ToolOk<T> = { status: "ok"; data: T };

/**
 * A tool call that found nothing to act on. This is a NORMAL outcome, never
 * an exception. In particular, a row hidden by RLS (the caller's workspace
 * cannot see it) returns `empty` with reason `not_visible`, exactly the same
 * shape as a row that genuinely does not exist (`not_found`). The model
 * never sees a thrown error or a stack trace for these cases, which is what
 * makes per-workspace RLS isolation invisible to it instead of something it
 * tries to route around (e.g. by retrying, guessing IDs, or asking the user
 * to "check permissions").
 */
export type ToolEmpty = {
  status: "empty";
  reason: "not_found" | "not_visible" | "no_results";
  message: string;
};

/**
 * A tool call that failed for a reason other than "nothing there" — a bad
 * argument, an unexpected downstream failure, etc. `message` is shown
 * directly to the user in the chat UI, so it must always be safe to render:
 * never a key, token, connection string, or raw Postgres/driver error text
 * (AS-105). Translate any lower-level error into a short, human sentence
 * before it reaches this type; do not pass `error.message` through
 * unmodified from a thrown exception.
 */
export type ToolError = { status: "error"; code: string; message: string };

/** The full envelope every tool's `run` function resolves to. */
export type ToolResult<T> = ToolOk<T> | ToolEmpty | ToolError;

/**
 * NOTE on `ToolEmpty.message`: never let the wording distinguish "this
 * document doesn't exist" from "this document exists but isn't visible to
 * you" — doing so would leak the fact that a document exists in a workspace
 * the caller can't see, which is exactly the information RLS exists to hide.
 * Callers should phrase `message` generically (e.g. "No matching document
 * found.") regardless of which `reason` fired.
 */

/**
 * Returned by write tools instead of mutating anything. Per
 * tech-decisions.md's write-safety rule, tool `run` functions never write to
 * the database — they compute and return a proposal. The user reviews it in
 * the UI and clicks Accept, which triggers an ordinary server action (a
 * separate code path from the AI tool loop) to perform the actual mutation.
 */
export type DocEditProposal = {
  kind: "doc_edit";
  proposalId: string; // crypto.randomUUID()
  docId: string;
  docTitle: string;
  /**
   * The exact document markdown the diff was computed against. Load-bearing,
   * not redundant with `docId`: F016's Accept flow re-fetches the live
   * document and compares it byte-for-byte against this field before
   * applying `proposedMarkdown`. If someone else edited the doc after this
   * proposal was generated, the comparison fails and the stale proposal is
   * rejected instead of silently clobbering their change. Do not drop this
   * field to save payload size.
   */
  currentMarkdown: string;
  proposedMarkdown: string;
  summary: string; // one line, human-facing
};

/** Returned by the "create a new document" tool instead of creating one. */
export type DocCreateProposal = {
  kind: "doc_create";
  proposalId: string; // crypto.randomUUID()
  title: string;
  markdown: string;
  folderId: string | null;
  templateName: string | null;
};

/** Constructs a `ToolOk<T>`. */
export function ok<T>(data: T): ToolOk<T> {
  return { status: "ok", data };
}

/** Constructs a `ToolEmpty`. See the type's doc comment for `reason` semantics. */
export function empty(reason: ToolEmpty["reason"], message: string): ToolEmpty {
  return { status: "empty", reason, message };
}

/** Constructs a `ToolError`. `message` must already be safe to render to a user. */
export function err(code: string, message: string): ToolError {
  return { status: "error", code, message };
}
