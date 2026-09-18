// Main orchestrator — port of the prototype's convert() from
// ~/Desktop/html-to-webflow/src/convert.mjs, tying together css.ts's
// parseCss(), emit.ts's emitWebflow(), js-extract.ts's extractScripts()/
// extractStyles(), and validator.ts's validatePayload() into one call.
//
// Pure function: no database, no filesystem, no persistent store (AS-129).
// Never throws for expected-bad input (AS-141) — problems surface as
// warnings/errors on the returned result.

import { mergeCssResults, parseCss } from "./css";
import { emitWebflow, isTextNode, type WebflowNode, type XscpData, type XscpPayload } from "./emit";
import { extractScripts, extractStyles } from "./js-extract";
import { validatePayload } from "./validator";

export interface ConvertResult {
  payload: XscpData | null;
  warnings: string[];
  /** Non-empty means payload is null (AS-119). */
  errors: string[];
  customCode: {
    scripts: string[];
  };
}

/**
 * Converts an HTML fragment plus a CSS stylesheet's text into a Webflow
 * clipboard payload, running CSS parsing, node/style assembly, custom-code
 * extraction, and validation. Never throws for expected-bad input.
 *
 * Inline <style> blocks found in `html` are merged into the CSS parsed
 * alongside the `css` argument (AS-089) — Webflow has no separate slot for
 * inline stylesheet text, so it becomes part of the style model rather than
 * custom code.
 *
 * AS-101: the conversion output includes all scripts found in the HTML
 * input and the JS-tab input, combined into a single custom-code output.
 * This function has no separate `js` parameter — by design (M3 engine
 * scope decision) the UI layer (M5) appends the JS-tab content to `html`
 * as one or more <script> blocks before calling convert(). The engine
 * itself only ever sees <script> tags embedded in `html` and treats every
 * one of them (inline body or external `src`) as custom code via
 * extractScripts(), so JS-tab content is processed transparently through
 * the same path as scripts already present in the HTML.
 */
export function convert(html: string, css: string): ConvertResult {
  const scriptsResult = extractScripts(html ?? "");
  const stylesResult = extractStyles(html ?? "");

  // Parse each CSS source independently and merge the results (AS-089): a
  // syntax error in any single source (the `css` argument or one <style>
  // block) must not blank out the declarations contributed by the other,
  // well-formed sources.
  const cssSources = [css ?? "", ...stylesResult.styles];
  const cssResult = mergeCssResults(
    cssSources.map((src, i) => {
      const result = parseCss(src);
      if (result.warnings.length > 0 && result.order.length === 0 && src.trim() !== "") {
        // Disambiguate which source a parse error came from — parseCss()
        // has no notion of "source index", so relabel here.
        return {
          ...result,
          warnings: result.warnings.map((w) =>
            w.startsWith("CSS parse error:")
              ? `CSS parse error in ${i === 0 ? "css input" : "<style> block " + i} : ${w.slice("CSS parse error: ".length)}`
              : w,
          ),
        };
      }
      return result;
    }),
  );
  const emitResult = emitWebflow(html ?? "", cssResult);

  const warnings = new Set([...emitResult.warnings, ...scriptsResult.warnings, ...stylesResult.warnings]);

  // AS-051: warn for every CSS class that is defined but never referenced by
  // any emitted node. Recurses into all descendant nodes, not just the
  // top-level ones, so a class used only on a deeply nested element is
  // correctly counted as used. Each node's own class list is tracked
  // separately (rather than flattened into one global set) so combo class
  // chains (e.g. "a|b" for ".a.b") can be matched against a single element
  // that actually carries every class in the chain, not just each class
  // individually somewhere in the tree.
  const nodeClassLists: string[][] = [];
  const collectUsedClasses = (node: WebflowNode): void => {
    nodeClassLists.push(node.classes ?? []);
    for (const child of node.children ?? []) {
      if (isTextNode(child)) continue;
      collectUsedClasses(child);
    }
  };
  for (const node of emitResult.payload.payload.nodes ?? []) {
    collectUsedClasses(node);
  }
  const usedClasses = new Set(nodeClassLists.flat());
  for (const [cls, parsed] of cssResult.classes) {
    const chain = parsed.comboOf ? [...parsed.comboOf, parsed.name] : [parsed.name];
    const isUsed =
      chain.length > 1
        ? nodeClassLists.some((classes) => chain.every((c) => classes.includes(c)))
        : usedClasses.has(parsed.name);
    if (!isUsed) {
      warnings.add(`CSS class "${cls}" is defined but not used by any HTML element`);
    }
  }

  const customCode = {
    scripts: scriptsResult.scripts,
  };

  const validation = validatePayload({
    ...emitResult.payload.payload,
    type: emitResult.payload.type,
  } as XscpPayload);

  if (!validation.valid) {
    for (const w of validation.warnings) warnings.add(w);
    return {
      payload: null,
      errors: validation.errors,
      warnings: Array.from(warnings),
      customCode,
    };
  }

  for (const w of validation.warnings) warnings.add(w);
  return {
    payload: emitResult.payload,
    errors: [],
    warnings: Array.from(warnings),
    customCode,
  };
}

/**
 * Convenience wrapper for a self-contained HTML document: extracts CSS from
 * inline <style> tags in the HTML itself, then delegates to convert().
 */
export function convertFromSource(html: string): ConvertResult {
  return convert(html ?? "", "");
}
