// F005: the "read the team's house style" tool. Same pattern F003/F004
// (lib/ai/tools/get-current-doc.ts, lib/ai/tools/search-docs.ts) already
// established:
//
//   1. A Zod `inputSchema` validated before any database call (this tool
//      takes no arguments beyond the caller's own session, but still keeps
//      the same `safeParse` shape for consistency with the other tools and
//      F006's tool registry).
//   2. A `run(input)` function that returns `Promise<ToolResult<T>>` from
//      lib/ai/tools/types.ts — never throws, never returns a bare object.
//   3. The RLS-respecting `createClient()` from `lib/supabase/server` —
//      never a service-role client (AS-002). RLS is the only enforcement
//      boundary, same as get_current_doc/search_docs.
//   4. A `name`/`description`/`inputSchema`/`run` export object matching
//      the shape F006's tool registry will import.
//
// Templates live in `task_templates` (a single table shared across
// kind='task'/'project'/'doc' — see
// supabase/migrations/20260822180000_task_templates.sql's header and
// supabase/migrations/20260909064152_task_templates_doc_kind.sql, which
// widened the kind CHECK to add 'doc' for this feature). This tool reads
// only `kind='doc'` rows (AS-024), scoped to the caller's workspace via
// RLS's existing `task_templates_select_non_guest_members` policy
// (AS-002) — no extra `.eq("workspace_id", ...)` filter is added on top,
// same convention F003/F004's handoffs record for any table whose RLS
// SELECT policy already scopes by workspace membership.
//
// `payload` is opaque jsonb per that migration's explicit DB/Zod split:
// the DB never validates payload shape, so this tool must. Templates are
// user-authored data (via a future authoring UI, out of scope for this
// feature) — a malformed or legacy payload must never crash the tool call,
// it must simply be skipped from the results (AS-028's "parse
// defensively" requirement), using `docTemplatePayloadSchema.safeParse`,
// never `.parse`.

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { docTemplatePayloadSchema } from "@/lib/validation/templates";
import { empty, err, ok, type ToolResult } from "@/lib/ai/tools/types";

export const listDocTemplatesInputSchema = z.object({});

export type ListDocTemplatesInput = z.infer<typeof listDocTemplatesInputSchema>;

export type DocTemplateItem = {
  id: string;
  name: string;
  sections: string[];
  rules: string[];
  tone: string | null;
  folderHint: string | null;
};

export type ListDocTemplatesData = {
  templates: DocTemplateItem[];
};

const NO_RESULTS_MESSAGE = "No document templates found.";

export async function run(
  input: ListDocTemplatesInput,
): Promise<ToolResult<ListDocTemplatesData>> {
  const parsed = listDocTemplatesInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return err("invalid_input", "That doesn't look like a valid request.");
  }

  const supabase = await createClient();

  // Scoped only by RLS (`task_templates_select_non_guest_members`,
  // supabase/migrations/20260822180000_task_templates.sql) plus the
  // `kind='doc'` filter — no other workspace's templates can ever be
  // returned no matter what filters are applied here (AS-002).
  const { data, error } = await supabase
    .from("task_templates")
    .select("id, name, payload")
    .eq("kind", "doc");

  if (error) {
    return err(
      "doc_templates_fetch_failed",
      "Something went wrong reading document templates.",
    );
  }

  if (!data || data.length === 0) {
    return empty("no_results", NO_RESULTS_MESSAGE);
  }

  const templates: DocTemplateItem[] = [];
  for (const row of data) {
    // Defensive parse: a malformed or legacy-shaped payload is skipped,
    // never thrown — templates are user-authored data, not code output.
    const result = docTemplatePayloadSchema.safeParse(row.payload);
    if (!result.success) continue;

    templates.push({
      id: row.id,
      name: row.name,
      sections: result.data.sections,
      rules: result.data.rules,
      tone: result.data.tone ?? null,
      folderHint: result.data.folderHint ?? null,
    });
  }

  if (templates.length === 0) {
    return empty("no_results", NO_RESULTS_MESSAGE);
  }

  return ok({ templates });
}

export const listDocTemplatesTool = {
  name: "list_doc_templates",
  description:
    "List the workspace's document-drafting templates (section outline, house rules, tone, and folder hint) so a new document can be drafted to the team's existing structure instead of an invented one. Returns an empty result if no templates exist yet.",
  inputSchema: listDocTemplatesInputSchema,
  run,
};
