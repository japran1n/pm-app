"use server";

// F022/F023/F024 (M4): Server Action wrapper around the pure M3 conversion
// engine (lib/webflow-converter/convert.ts). Auth-gated (AS-004, AS-012) but
// otherwise stateless -- this file never reads or writes any application
// table.
//
// AS-011: no table read/write -- stateless compute only. The only Supabase
// call made here is auth.getUser(), used purely to gate access; no `.from()`
// call exists anywhere in this file.

import { getCurrentUser } from "@/lib/auth/current-user";
import { convert } from "../webflow-converter/convert";

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

export async function convertHtmlToWebflow(input: {
  html: string;
  css: string;
  js?: string;
}): Promise<ConvertActionResult> {
  const { user } = await getCurrentUser();
  if (!user) {
    return { ok: false, message: "Unauthorized" };
  }

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

  return {
    ok: true,
    json: JSON.stringify(result.payload),
    js: result.customCode?.scripts ?? [],
    errors: result.errors,
    warnings: result.warnings,
    stats: {
      nodeCount: result.payload.payload.nodes.length,
      styleCount: result.payload.payload.styles.length,
    },
  };
}
