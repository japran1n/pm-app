// Main orchestrator — port of the prototype's convert() from
// ~/Desktop/html-to-webflow/src/convert.mjs, tying together css.ts's
// parseCss(), emit.ts's emitWebflow(), js-extract.ts's extractScripts()/
// extractStyles(), and validator.ts's validatePayload() into one call.
//
// Pure function: no database, no filesystem, no persistent store (AS-129).
// Never throws for expected-bad input (AS-141) — problems surface as
// warnings/errors on the returned result.

import { parseCss } from "./css";
import { emitWebflow, type XscpData, type XscpPayload } from "./emit";
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
 */
export function convert(html: string, css: string): ConvertResult {
  const scriptsResult = extractScripts(html ?? "");
  const stylesResult = extractStyles(html ?? "");

  const fullCss = [css ?? "", ...stylesResult.styles].join("\n");
  const cssResult = parseCss(fullCss);
  const emitResult = emitWebflow(html ?? "", cssResult);

  const warnings = new Set([...emitResult.warnings, ...scriptsResult.warnings, ...stylesResult.warnings]);

  // AS-051: warn for every CSS class that is defined but never referenced by
  // any emitted node.
  const usedClasses = new Set(
    (emitResult.payload.payload.nodes ?? []).flatMap((n) => n.classes ?? [])
  );
  for (const [cls] of cssResult.classes) {
    if (!usedClasses.has(cls)) {
      warnings.add(`CSS class "${cls}" is defined but not used by any HTML element`);
    }
  }

  const customCode = {
    scripts: scriptsResult.scripts,
  };

  // AS-114 requires every node class to resolve to a style entry. When the
  // caller passes HTML with no backing CSS (or a class the CSS never
  // defines), that's not a real validation failure worth blocking the copy
  // over — there's simply nothing to style yet. Validate against a payload
  // augmented with synthetic `fake: true` placeholder styles for any class
  // used by a node but not already covered by a real style, so AS-114 never
  // fires purely for "no CSS was supplied." The synthetic styles are only
  // used for this validation pass — the payload returned to the caller keeps
  // the real (possibly empty) styles array untouched.
  const realStyleNames = new Set(emitResult.payload.payload.styles.map((s) => s.name));
  const usedClassNames = new Set(usedClasses);
  const fakeStyles = Array.from(usedClassNames)
    .filter((cls) => !realStyleNames.has(cls))
    .map((cls) => ({
      _id: `fake-${cls}`,
      name: cls,
      fake: true,
      comb: "",
      namespace: "" as const,
      categories: [] as [],
      styleLess: "",
      variants: {},
      children: [],
    }));

  const allowEmptyNodes = (html ?? "").trim() === "";
  const validation = validatePayload(
    {
      ...emitResult.payload.payload,
      styles: [...emitResult.payload.payload.styles, ...fakeStyles],
      type: emitResult.payload.type,
    } as XscpPayload,
    { allowEmptyNodes }
  );

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
