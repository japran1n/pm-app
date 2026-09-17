// Inline script/style extraction for display purposes.
//
// Deliberately simpler than the prototype's src/convert.mjs: no GSAP
// plugin auto-detection, no CDN auto-injection. This is a pure
// extract-and-warn pass over inline <script> and <style> content — nothing
// more (per F019's clarified scope).

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
 * Extracts inline <script> text content from an HTML fragment. External
 * scripts (with a src attribute) are never fetched or included — they only
 * produce a warning telling the user to add them manually in Webflow.
 * Never throws for expected-bad input.
 */
export function extractScripts(html: string): ExtractScriptsResult {
  const scripts: string[] = [];
  const warnings: string[] = [];

  const root = parse(html ?? "");
  const scriptEls = root.querySelectorAll("script");

  for (const el of scriptEls) {
    const src = el.getAttribute("src");
    if (src !== undefined && src.trim() !== "") {
      warnings.push(`external script '${src}' not included — add manually in Webflow custom code`);
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
