// Inline script/style extraction for display purposes.
//
// Deliberately simpler than the prototype's src/convert.mjs: no GSAP
// plugin auto-detection, no CDN auto-injection. Inline <script>/<style>
// content and external <script src> tag markup are carried through in
// source order; external scripts also get an advisory warning (per F019's
// clarified scope, amended by F077 to carry rather than skip external
// scripts).

import { NodeType, parse } from "node-html-parser";

export interface ExtractScriptsResult {
  scripts: string[];
  warnings: string[];
}

export interface ExtractStylesResult {
  styles: string[];
  warnings: string[];
}

/**
 * Extracts <script> tags from an HTML fragment, in source order. Inline
 * scripts contribute their text content; external scripts (with a src
 * attribute) are never fetched, but their original tag markup is carried
 * into the output verbatim, with no allowlist restriction and no stripping.
 * An advisory warning accompanies each external script — it does not
 * replace the inclusion. Never throws for expected-bad input.
 */
export function extractScripts(html: string): ExtractScriptsResult {
  const scripts: string[] = [];
  const warnings: string[] = [];

  const root = parse(html ?? "");
  const scriptEls = root.querySelectorAll("script");

  for (const el of scriptEls) {
    const src = el.getAttribute("src");
    if (src !== undefined && src.trim() !== "") {
      warnings.push(`external script '${src}' included in custom code — verify it loads correctly in Webflow`);
      scripts.push(el.outerHTML);
      continue;
    }

    const content = el.childNodes
      .filter((n) => n.nodeType === NodeType.TEXT_NODE)
      .map((n) => n.rawText)
      .join("");

    if (content.trim() !== "") {
      scripts.push(content);
    }
  }

  return { scripts, warnings };
}

/**
 * Extracts inline <style> block text content from an HTML fragment. These
 * are separate from linked <link rel="stylesheet"> stylesheets, which are
 * out of scope here. Never throws for expected-bad input.
 */
export function extractStyles(html: string): ExtractStylesResult {
  const styles: string[] = [];
  const warnings: string[] = [];

  const root = parse(html ?? "");
  const styleEls = root.querySelectorAll("style");

  for (const el of styleEls) {
    const content = el.childNodes
      .filter((n) => n.nodeType === NodeType.TEXT_NODE)
      .map((n) => n.rawText)
      .join("");

    if (content.trim() !== "") {
      styles.push(content);
    }
  }

  return { styles, warnings };
}
