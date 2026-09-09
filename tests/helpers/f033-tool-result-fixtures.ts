// F033 (fixes M2-SCRUTINY.md B1): the ONE fixture module both
// tests/integration/f007-docs-agent-route.test.ts and
// tests/unit/f011-tool-call-card.test.tsx import for tool-call
// summary/detail/args fixtures.
//
// Every fixture here is derived by calling the route's own real
// lib/ai/tool-result-display.ts functions against real `ToolResult`
// envelopes (lib/ai/tools/types.ts's `ok`/`empty`/`err` constructors) —
// never hand-invented strings. That is the actual fix for B1: the old
// f011 test built `summary: "Found 3 matching docs"` / `detail:
// "onboarding.md, setup.md, faq.md"`, neither of which the route could
// ever produce. Importing from this module instead makes that class of
// drift impossible — if lib/ai/tool-result-display.ts's output shape ever
// changes, both test suites pick up the change automatically instead of
// one silently going stale.

import { ok, empty, err } from "@/lib/ai/tools/types";
import type { SearchDocsData } from "@/lib/ai/tools/search-docs";
import type { GetCurrentDocData } from "@/lib/ai/tools/get-current-doc";
import {
  describeToolResult,
  sanitizeToolArgsForDisplay,
  type ToolResultDescription,
} from "@/lib/ai/tool-result-display";
import type { ToolCallView } from "@/lib/ai/use-doc-assistant";

// --- search_docs: a real success result, shaped exactly like
// lib/ai/tools/search-docs.ts's `run()` return value. ------------------

export const SEARCH_DOCS_ARGS_RAW = { query: "onboarding" };
export const SEARCH_DOCS_ARGS_SUMMARY = sanitizeToolArgsForDisplay(SEARCH_DOCS_ARGS_RAW);

export const SEARCH_DOCS_OK_DATA: SearchDocsData = {
  results: [
    { docId: "d1", title: "onboarding.md", folderName: null, snippet: "Welcome to the team..." },
    { docId: "d2", title: "setup.md", folderName: null, snippet: "Install the CLI..." },
    { docId: "d3", title: "faq.md", folderName: "Guides", snippet: "Frequently asked..." },
  ],
};
export const SEARCH_DOCS_OK_CONTENT = JSON.stringify(ok(SEARCH_DOCS_OK_DATA));
export const SEARCH_DOCS_OK_DESCRIPTION: ToolResultDescription =
  describeToolResult(SEARCH_DOCS_OK_CONTENT);

export const SEARCH_DOCS_EMPTY_CONTENT = JSON.stringify(
  empty("no_results", "No matching documents found."),
);
export const SEARCH_DOCS_EMPTY_DESCRIPTION: ToolResultDescription =
  describeToolResult(SEARCH_DOCS_EMPTY_CONTENT);

// --- get_current_doc: a real success result. ---------------------------

export const GET_CURRENT_DOC_OK_DATA: GetCurrentDocData = {
  docId: "d1",
  title: "Onboarding Guide",
  markdown: "# Onboarding\n\nWelcome...",
  folderName: null,
  clientVisible: true,
  wordCount: 1240,
  truncated: false,
};
export const GET_CURRENT_DOC_OK_CONTENT = JSON.stringify(ok(GET_CURRENT_DOC_OK_DATA));
export const GET_CURRENT_DOC_OK_DESCRIPTION: ToolResultDescription = describeToolResult(
  GET_CURRENT_DOC_OK_CONTENT,
);

// --- a thrown-tool / not-found error: the ONLY case that legitimately
// carries the literal `summary: "tool error"` the card component keys
// its failed-state rendering on (see tool-call-card.tsx's header
// comment). Not run through describeToolResult — this is the route's
// dedicated error path (route.ts's `catch (toolError)` branch), not a
// `ToolResult` envelope. ------------------------------------------------

export const TOOL_ERROR_SUMMARY = "tool error";
export const TOOL_ERROR_DETAIL = "Tool execution failed.";

// A ToolResult-shaped error too, for completeness (a tool that itself
// returns `err(...)` rather than throwing).
export const SEARCH_DOCS_ERROR_CONTENT = JSON.stringify(
  err("doc_search_failed", "Something went wrong searching documents."),
);
export const SEARCH_DOCS_ERROR_DESCRIPTION: ToolResultDescription = describeToolResult(
  SEARCH_DOCS_ERROR_CONTENT,
);

// --- ToolCallView builders: the same round-trip use-doc-assistant.ts
// produces from tool_start + tool_end for the fixtures above. Used by
// tests/unit/f011-tool-call-card.test.tsx so its fixtures can never
// diverge from what the route can actually emit. -----------------------

export function searchDocsDoneToolCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: "t1",
    name: "search_docs",
    status: "done",
    args: SEARCH_DOCS_ARGS_SUMMARY,
    summary: SEARCH_DOCS_OK_DESCRIPTION.summary,
    detail: SEARCH_DOCS_OK_DESCRIPTION.detail,
    ...overrides,
  };
}

export function searchDocsRunningToolCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: "t1",
    name: "search_docs",
    status: "running",
    args: SEARCH_DOCS_ARGS_SUMMARY,
    ...overrides,
  };
}

export function getCurrentDocDoneToolCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: "t3",
    name: "get_current_doc",
    status: "done",
    summary: GET_CURRENT_DOC_OK_DESCRIPTION.summary,
    detail: GET_CURRENT_DOC_OK_DESCRIPTION.detail,
    ...overrides,
  };
}

export function toolThrewFailedToolCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: "t2",
    name: "get_current_doc",
    status: "done",
    summary: TOOL_ERROR_SUMMARY,
    detail: TOOL_ERROR_DETAIL,
    ...overrides,
  };
}
