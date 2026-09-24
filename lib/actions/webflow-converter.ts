"use server";

// F022/F023/F024 (M4): Server Action wrapper around the pure M3 conversion
// engine (lib/webflow-converter/convert.ts). Stateless compute: the only
// table touched is the workspace/membership lookup that gates access -- the
// conversion itself never reads or writes application data.
//
// The converter is a team tool (it lives under /w/[slug]/tools), so callers
// must be an owner/admin/member of the workspace they are converting from;
// clients, guests and viewers are refused. Input size is capped before the
// engine runs, the engine enforces its own depth/element/output limits, and
// any unexpected failure comes back as `{ ok: false, message }`, never a
// thrown error.

import { z } from "zod";

import { withAuthz } from "@/lib/actions/authz";
import { canTeamWrite } from "@/lib/auth/permissions";
import { convert } from "../webflow-converter/convert";
import {
  INPUT_TOO_LARGE_ERROR,
  MAX_OUTPUT_CHARS,
  MAX_SOURCE_CHARS,
  OUTPUT_TOO_LARGE_ERROR,
} from "../webflow-converter/limits";

export interface ConvertActionResult {
  ok: boolean;
  /** Human-readable error, only present when ok: false. */
  message?: string;
  /** JSON.stringify of the Webflow clipboard payload, only when ok: true. */
  json?: string;
  /** customCode.scripts array, only when ok: true. */
  js?: string[];
  /** Always present, may be empty. */
  warnings?: string[];
  /** Always present, may be empty. */
  errors?: string[];
  stats?: {
    nodeCount: number;
    styleCount: number;
  };
}

const sourceField = z.string().max(MAX_SOURCE_CHARS, INPUT_TOO_LARGE_ERROR);

const convertInputSchema = z.object({
  workspaceSlug: z.string().min(1, "Workspace not found.").max(200),
  html: sourceField,
  css: sourceField,
  js: sourceField.optional(),
});

type ConvertInput = z.infer<typeof convertInputSchema>;

// JS-tab architecture decision (per convert.ts's own doc comment on AS-101):
// the engine has no separate `js` parameter. Callers of this action are
// expected to have already embedded any JS-tab content into `input.html` as
// <script> tag(s) before invoking the action; `input.js` is accepted purely
// so a caller that hasn't done that inline-injection itself can rely on this
// action to do it, matching the documented UI contract.
function withInjectedScript(html: string, js?: string): string {
  if (!js || js.trim() === "") return html;
  const safeJs = js.replace(/<\/script>/gi, "<\\/script>");
  return `${html}\n<script>\n${safeJs}\n</script>`;
}

// `payload.nodes` is a flat array (each element/text node is a top-level
// entry; element `children` hold child `_id` strings, not nested objects) --
// so the node count is simply the array length.
function countNodes(nodes: unknown[]): number {
  return Array.isArray(nodes) ? nodes.length : 0;
}

function runConversion(input: ConvertInput): ConvertActionResult {
  if (input.html.trim() === "") {
    return {
      ok: false,
      message: "Paste some HTML to convert.",
      warnings: [],
      errors: [],
    };
  }

  const html = withInjectedScript(input.html, input.js);
  const result = convert(html, input.css);

  if (result.payload === null) {
    return {
      ok: false,
      message: result.errors[0] ?? "Conversion failed.",
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  const json = JSON.stringify(result.payload);
  if (json.length > MAX_OUTPUT_CHARS) {
    return {
      ok: false,
      message: OUTPUT_TOO_LARGE_ERROR,
      errors: [OUTPUT_TOO_LARGE_ERROR],
      warnings: result.warnings,
    };
  }

  return {
    ok: true,
    json,
    js: result.customCode?.scripts ?? [],
    errors: result.errors,
    warnings: result.warnings,
    stats: {
      nodeCount: countNodes(result.payload.payload.nodes),
      styleCount: result.payload.payload.styles.length,
    },
  };
}

const convertAuthorized = withAuthz(
  convertInputSchema,
  {
    requireWrite: true,
    writeCheck: canTeamWrite,
    notSignedInError: "Unauthorized",
    membershipError: "Unauthorized",
    writeError: "Unauthorized",
    resolveWorkspace: async (input, admin) => {
      const { data, error } = await admin
        .from("workspaces")
        .select("id")
        .eq("slug", input.workspaceSlug)
        .maybeSingle();
      if (error || !data) return { ok: false, error: "Unauthorized" };
      return { ok: true, workspaceId: data.id, extra: {} };
    },
  },
  async (input) => {
    try {
      return runConversion(input);
    } catch {
      return { ok: false, message: "Conversion failed unexpectedly." };
    }
  },
);

export async function convertHtmlToWebflow(input: {
  workspaceSlug: string;
  html: string;
  css: string;
  js?: string;
}): Promise<ConvertActionResult> {
  try {
    const result = await convertAuthorized(input);
    if (result.ok === false && "error" in result) {
      return { ok: false, message: result.error };
    }
    return result;
  } catch {
    return { ok: false, message: "Conversion failed unexpectedly." };
  }
}
