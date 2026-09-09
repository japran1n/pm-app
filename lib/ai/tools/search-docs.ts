// F004: the "find documents I wasn't handed" tool. Same pattern F003
// (lib/ai/tools/get-current-doc.ts) established:
//
//   1. A Zod `inputSchema` validated before any database call.
//   2. A `run(input)` function that returns `Promise<ToolResult<T>>` from
//      lib/ai/tools/types.ts — never throws, never returns a bare object.
//   3. The RLS-respecting `createClient()` from `lib/supabase/server` —
//      never a service-role client (AS-001, AS-002). Per tech-decisions.md,
//      the AI layer gets no service-role key; RLS is the only enforcement
//      boundary, exactly like every other query in this codebase.
//   4. A `name`/`description`/`inputSchema`/`run` export object matching
//      the shape F006's tool registry will import.
//
// Existing search helpers checked before writing this query (per spec's
// "look first" instruction):
//   - lib/actions/palette-search.ts — searches projects/tasks/members, not
//     docs. Its project search does a simple `.ilike("name", pattern)` on
//     the RLS-scoped session client with no admin-client bypass for the
//     actual query (only for a defense-in-depth membership re-check) —
//     this file's `.ilike()` approach on `docs` mirrors that same
//     established convention.
//   - lib/actions/chat-search.ts / lib/queries/chat.ts — full-text search
//     over chat messages via `searchChannelMessages`, a different table
//     entirely.
//   - lib/queries/search.ts — workspace task search via the `search_tasks`
//     Postgres RPC (F068). No equivalent RPC exists for `docs`
//     (grep of supabase/migrations turns up no `search_docs`/doc-FTS
//     function), so there is nothing to reuse for the query itself; a
//     dedicated `.ilike()` query against `docs` here is the smallest
//     addition that doesn't duplicate an existing doc-search path (there
//     is currently no other doc-search code anywhere in the app).
//   - lib/queries/docs.ts — general doc CRUD/listing queries, no search
//     helper.
//
// Snippet extraction: ~200 chars centered on the first case-insensitive
// match of the query inside `content`. If the match is only in the title
// (not in the body at all), the snippet falls back to the document's
// opening characters instead — this tool never returns a full body, since
// that would blow out the model's context on every search call (that's
// what get_current_doc is for).

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { empty, err, ok, type ToolResult } from "@/lib/ai/tools/types";

const MAX_RESULTS = 10;
const SNIPPET_RADIUS = 100; // ~200 chars total around the match
const SNIPPET_FALLBACK_LENGTH = 200;

export const searchDocsInputSchema = z.object({
  query: z.string().min(1),
  projectId: z.string().uuid().optional(),
});

export type SearchDocsInput = z.infer<typeof searchDocsInputSchema>;

export type SearchDocsResultItem = {
  docId: string;
  title: string;
  folderName: string | null;
  snippet: string;
};

export type SearchDocsData = {
  results: SearchDocsResultItem[];
};

function buildSnippet(title: string, content: string, query: string): string {
  const haystack = content ?? "";
  const lowerHaystack = haystack.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerQuery ? lowerHaystack.indexOf(lowerQuery) : -1;

  if (matchIndex === -1) {
    // Match was in the title, not the body: use the document's opening
    // instead of a body excerpt centered on nothing.
    const opening = haystack.trim().slice(0, SNIPPET_FALLBACK_LENGTH);
    return opening.length < haystack.trim().length ? `${opening}...` : opening;
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, matchIndex + lowerQuery.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < haystack.length ? "..." : "";
  return `${prefix}${haystack.slice(start, end).trim()}${suffix}`;
}

export async function run(
  input: SearchDocsInput,
): Promise<ToolResult<SearchDocsData>> {
  const parsed = searchDocsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err("invalid_input", "That doesn't look like a valid search request.");
  }

  const trimmedQuery = parsed.data.query.trim();
  if (!trimmedQuery) {
    return err("invalid_input", "Search query cannot be empty.");
  }

  const supabase = await createClient();

  // Escape ilike's own wildcard characters in the user's query.
  const likePattern = `%${trimmedQuery.replace(/[%_]/g, "\\$&")}%`;

  const select = "id, title, content, project_id, doc_folders(name)";

  // NOTE: unlike lib/actions/palette-search.ts's single-column `.ilike()`,
  // this tool needs to match either of two columns. The naive port of that
  // convention would be `.or(\`title.ilike.${p},content.ilike.${p}\`)`, but
  // `.or()` takes a filter *string* where comma/parens/dot are grammar —
  // interpolating a model-influenced query into it is filter injection
  // (`budget, revised` becomes two OR terms). `.ilike()` as a *method* below
  // takes the pattern as a bound parameter, so that grammar never applies.
  // Run one bound query per column and merge, rather than hand-building a
  // filter string.
  const buildQuery = (column: "title" | "content") => {
    let builder = supabase
      .from("docs")
      .select(select)
      .ilike(column, likePattern)
      // Deterministic ordering: without this, which MAX_RESULTS of N rows
      // come back is arbitrary and can vary between calls.
      .order("id", { ascending: true })
      .limit(MAX_RESULTS);

    // Workspace scoping is enforced by RLS (`docs_select_active_members`)
    // on every row this query can possibly return — no other workspace's
    // docs are visible to this session no matter what filters are applied
    // here (AS-023, AS-008). `projectId`, when given, narrows further
    // within that already-scoped set.
    if (parsed.data.projectId) {
      builder = builder.eq("project_id", parsed.data.projectId);
    }
    return builder;
  };

  const [titleResult, contentResult] = await Promise.all([
    buildQuery("title"),
    buildQuery("content"),
  ]);

  if (titleResult.error || contentResult.error) {
    return err("doc_search_failed", "Something went wrong searching documents.");
  }

  const merged = new Map<string, (typeof titleResult.data)[number]>();
  for (const row of [...(titleResult.data ?? []), ...(contentResult.data ?? [])]) {
    if (!merged.has(row.id)) merged.set(row.id, row);
  }
  const data = Array.from(merged.values())
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_RESULTS);

  if (data.length === 0) {
    return empty("no_results", "No matching documents found.");
  }

  const results: SearchDocsResultItem[] = data.map((row) => {
    const folder = row.doc_folders as { name: string } | { name: string }[] | null;
    const folderName = Array.isArray(folder) ? (folder[0]?.name ?? null) : (folder?.name ?? null);
    return {
      docId: row.id,
      title: row.title,
      folderName,
      snippet: buildSnippet(row.title, row.content ?? "", trimmedQuery),
    };
  });

  return ok({ results });
}

export const searchDocsTool = {
  name: "search_docs",
  description:
    "Search documents by title or content within the caller's workspace, optionally narrowed to a project. Returns up to 10 matches with a short snippet each. Returns an empty result if nothing matches.",
  inputSchema: searchDocsInputSchema,
  run,
};
