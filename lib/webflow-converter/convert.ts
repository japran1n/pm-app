// Main orchestrator — port of the prototype's convert() from
// ~/Desktop/html-to-webflow/src/convert.mjs, tying together css.ts's
// parseCss(), emit.ts's emitWebflow(), js-extract.ts's extractScripts()/
// extractStyles(), and validator.ts's validatePayload() into one call.
//
// Pure function: no database, no filesystem, no persistent store (AS-129).
// Never throws for expected-bad input (AS-141) — problems surface as
// warnings/errors on the returned result.

import { parseCss } from "./css";
import { emitWebflow, type XscpData } from "./emit";
import { extractScripts, extractStyles } from "./js-extract";
import { validatePayload } from "./validator";

export interface ConvertResult {
  payload: XscpData | null;
  warnings: string[];
  /** Non-empty means payload is null (AS-119). */
  errors: string[];
  customCode: {
    scripts: string[];
    styles: string[];
  };
}

/**
 * Converts an HTML fragment plus a CSS stylesheet's text into a Webflow
 * clipboard payload, running CSS parsing, node/style assembly, custom-code
 * extraction, and validation. Never throws for expected-bad input.
 */
export function convert(html: string, css: string): ConvertResult {
  const cssResult = parseCss(css ?? "");
  const emitResult = emitWebflow(html ?? "", cssResult);

  const scriptsResult = extractScripts(html ?? "");
  const stylesResult = extractStyles(html ?? "");

  const warnings = Array.from(
    new Set([...emitResult.warnings, ...scriptsResult.warnings, ...stylesResult.warnings])
  );

  const customCode = {
    scripts: scriptsResult.scripts,
    styles: stylesResult.styles,
  };

  const validation = validatePayload(emitResult.payload.payload);

  if (!validation.valid) {
    return {
      payload: null,
      errors: validation.errors,
      warnings: Array.from(new Set([...warnings, ...validation.warnings])),
      customCode,
    };
  }

  return {
    payload: emitResult.payload,
    errors: [],
    warnings: Array.from(new Set([...warnings, ...validation.warnings])),
    customCode,
  };
}

/**
 * Convenience wrapper for a self-contained HTML document: extracts CSS from
 * inline <style> tags in the HTML itself, then delegates to convert().
 */
export function convertFromSource(html: string): ConvertResult {
  const stylesResult = extractStyles(html ?? "");
  const css = stylesResult.styles.join("\n");
  return convert(html ?? "", css);
}
