// F033 (fixes M2-SCRUTINY.md B1 / AS-063): the ONE place that turns a raw
// tool call — its model-controlled arguments and its `ToolResult` envelope
// (lib/ai/tools/types.ts) — into the short, sanitised strings
// app/api/ai/docs/route.ts is allowed to put on the wire in `tool_start`'s
// `args` and `tool_end`'s `summary`/`detail`.
//
// Extracted out of route.ts (rather than left inline) so this module can be
// imported directly by both the route's own contract test and
// components/ai/tool-call-card.tsx's test — see
// tests/helpers/f033-tool-result-fixtures.ts, the shared fixture module
// this feature's spec calls for. Neither test hand-invents a summary/detail
// string; both derive them by calling these exact functions, so the UI test
// can never again assert against a data shape the route cannot actually
// emit (M2-SCRUTINY.md's B1).
//
// Nothing here does I/O. Every function is a pure string transform, safe to
// import from a route module, a test file, or (in principle) a client
// module.

import type { ToolResult } from "@/lib/ai/tools/types";

/** Hard caps applied before anything model- or user-authored reaches the wire. */
const MAX_TOOL_NAME_DISPLAY_LEN = 64;
const MAX_ARG_SUMMARY_LEN = 200;
const MAX_DETAIL_LEN = 300;
const MAX_SUMMARY_LEN = 120;

/**
 * F032: bounds length and charset on a model-controlled tool name before it
 * is interpolated into a client-facing `detail` string. Real tool names are
 * short, lowercase, snake_case identifiers this route itself defines — so
 * anything outside `[a-zA-Z0-9_-]`, or over a generous length cap, is either
 * not a real tool name or an attempt to smuggle something through `detail`;
 * either way it gets truncated and stripped down to a safe-to-render token.
 */
export function sanitizeToolNameForDisplay(name: string): string {
  const stripped = name.replace(/[^a-zA-Z0-9_-]/g, "");
  const bounded = stripped.slice(0, MAX_TOOL_NAME_DISPLAY_LEN);
  return bounded.length > 0 ? bounded : "unknown";
}

/**
 * Bounds length and strips control characters (including newlines/tabs, so
 * a title or snippet can never break the single-line NDJSON envelope or the
 * card's one-line summary row) from free-form, user- or model-authored
 * text before it is rendered. Unlike `sanitizeToolNameForDisplay`, this
 * keeps ordinary punctuation and unicode — these are document titles and
 * search snippets, not identifiers — so it is a control-character allowlist
 * plus a length bound rather than an alphanumeric allowlist.
 */
export function sanitizeDisplayText(text: string, maxLen: number = MAX_DETAIL_LEN): string {
  const stripped = text.replace(/[\x00-\x1F\x7F]/g, " ").trim();
  if (stripped.length <= maxLen) return stripped;
  return `${stripped.slice(0, maxLen)}…`;
}

/**
 * F033: a sanitised, length-bounded summary of a tool call's arguments,
 * carried on `tool_start`. `input` is entirely model-controlled and, per
 * this feature's spec, ultimately traceable to document text a
 * client-portal user can author — so this is the same threat model F032
 * bounded for the tool name, applied to a JSON blob instead of a single
 * identifier: bound length, strip control characters, never forward
 * anything unbounded. Returns "" (never rendered) for tools with no
 * meaningful arguments (e.g. list_doc_templates's `{}`).
 */
export function sanitizeToolArgsForDisplay(input: unknown): string {
  let raw: string;
  try {
    raw = JSON.stringify(input) ?? "";
  } catch {
    return "";
  }
  if (!raw || raw === "{}" || raw === "null") return "";
  return sanitizeDisplayText(raw, MAX_ARG_SUMMARY_LEN);
}

export type ToolResultDescription = { summary: string; detail?: string };

/**
 * Turns a tool's raw JSON result string into the safe `{summary, detail}`
 * pair `tool_end` sends. Only ever reads specific, known-shape fields off
 * the parsed `ToolResult` envelope (lib/ai/tools/types.ts) — never forwards
 * `content` itself or any other raw field, per this feature's spec ("the
 * server computes a safe string; it never forwards raw model output").
 *
 * `detail` is only populated on a genuine "ok" result with recognised
 * data (search results, templates, or a single document) — an unrecognised
 * shape or a parse failure falls back to the bare "ok" summary with no
 * detail, which is exactly the pre-F033 behaviour for anything this
 * function doesn't specifically know how to describe (e.g. a future tool).
 */
export function describeToolResult(content: string): ToolResultDescription {
  let parsed: ToolResult<unknown>;
  try {
    parsed = JSON.parse(content) as ToolResult<unknown>;
  } catch {
    return { summary: "ok" };
  }

  if (!parsed || typeof parsed !== "object") return { summary: "ok" };

  if (parsed.status === "empty") {
    return { summary: sanitizeDisplayText(parsed.message ?? "no results", MAX_SUMMARY_LEN) };
  }

  if (parsed.status === "error") {
    return { summary: sanitizeDisplayText(parsed.message ?? "tool error", MAX_SUMMARY_LEN) };
  }

  if (parsed.status !== "ok") return { summary: "ok" };

  const data = parsed.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== "object") return { summary: "ok" };

  // search_docs's SearchDocsData: { results: SearchDocsResultItem[] }.
  if (Array.isArray(data.results)) {
    const results = data.results as Array<{ title?: unknown }>;
    const n = results.length;
    const titles = results
      .map((r) => (typeof r.title === "string" ? r.title : null))
      .filter((t): t is string => Boolean(t));
    return {
      summary: `${n} doc${n === 1 ? "" : "s"}`,
      detail: titles.length > 0 ? sanitizeDisplayText(titles.join(", ")) : undefined,
    };
  }

  // list_doc_templates's ListDocTemplatesData: { templates: DocTemplateItem[] }.
  if (Array.isArray(data.templates)) {
    const templates = data.templates as Array<{ name?: unknown }>;
    const n = templates.length;
    const names = templates
      .map((t) => (typeof t.name === "string" ? t.name : null))
      .filter((t): t is string => Boolean(t));
    return {
      summary: `${n} template${n === 1 ? "" : "s"}`,
      detail: names.length > 0 ? sanitizeDisplayText(names.join(", ")) : undefined,
    };
  }

  // get_current_doc's GetCurrentDocData: { wordCount: number, title: string, ... }.
  if (typeof data.wordCount === "number") {
    const words = data.wordCount;
    return {
      summary: `${words.toLocaleString("en-US")} word${words === 1 ? "" : "s"}`,
      detail: typeof data.title === "string" ? sanitizeDisplayText(data.title, MAX_SUMMARY_LEN) : undefined,
    };
  }

  // An "ok" result this function doesn't specifically know how to describe
  // (e.g. a future tool) — never falls back to forwarding raw content.
  return { summary: "ok" };
}
