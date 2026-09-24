// F295 — AS-560: assembles the final plain-text description sent to
// F292's POST /api/extension/tasks route by appending a structured,
// readable technical-metadata block AFTER the reporter's own free-text
// description.
//
// M14 fallback note (per this feature's spec, "uses the rich-text
// document format from M14 (F170) when available; falls back to plain
// text and says so in the handoff if M14 has not landed"): as of this
// mission, no `lib/editor/` directory or F170 handoff exists, and
// `lib/validation/tasks.ts`'s `description` field is a plain `string`
// (see createTaskSchema). This module therefore builds a single combined
// PLAIN TEXT string — no rich-text document shape is invented or guessed
// at here. If/when M14 lands, a future feature can swap this module's
// output type without changing its call sites' contract (a plain string
// in, a plain string out).
//
// Ordering (spec: "the reporter's own words come first — the machine
// detail must not bury them."): this function always places the
// reporter's own text, byte-for-byte and unmodified, at the very start
// of the returned string. The metadata block is appended after a clear
// `---` delimiter, never interleaved or prepended.
//
// Console/network log capture support has been removed entirely (not
// needed) — this module now only ever assembles the environment-metadata
// and picked-element sections after the reporter's own text.
export type DescribeEnvironment = {
  pageUrl: string;
  browserName: string;
  browserVersion: string;
  os: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

export type DescribeElement = {
  selector: string;
  /** The picked element's bounding box, in the same shape
   * `element-picker.ts`'s `finish({ rect: ... })` already produces
   * (viewport-relative CSS pixels from `getBoundingClientRect()`). */
  rect: { x: number; y: number; width: number; height: number };
};

export type BuildDescriptionInput = {
  /** The reporter's own free-text description, exactly as typed. May be empty. */
  reporterText: string;
  /** F288's `collectEnvironmentMetadata()` result, if available. */
  environment?: DescribeEnvironment | null;
  /** F287's picked-element result, if the reporter used the picker. */
  element?: DescribeElement | null;
};

const SEPARATOR = "---";
const METADATA_HEADING = "Technical details (captured automatically)";

/**
 * Assembles the final combined plain-text description: the reporter's own
 * words, unmodified, first — followed by a clearly-delimited structured
 * metadata block built only from sections that actually have data.
 *
 * If NO metadata is available at all (no environment, no element), the
 * reporter's text is returned unchanged — no empty/misleading metadata
 * block is ever appended.
 */
export function buildTaskDescription(input: BuildDescriptionInput): string {
  const reporterText = input.reporterText ?? "";
  const sections: string[] = [];

  if (input.environment) {
    const env = input.environment;
    sections.push(
      [
        "Environment:",
        `  URL: ${env.pageUrl}`,
        `  Browser: ${env.browserName} ${env.browserVersion}`,
        `  OS: ${env.os}`,
        `  Viewport: ${env.viewportWidth} x ${env.viewportHeight} px`,
        `  Device pixel ratio: ${env.devicePixelRatio}`,
      ].join("\n"),
    );
  }

  if (input.element) {
    const { rect } = input.element;
    sections.push(
      [
        "Picked element:",
        `  Selector: ${input.element.selector}`,
        `  Position: ${rect.x}, ${rect.y}`,
        `  Size: ${rect.width} x ${rect.height}`,
      ].join("\n"),
    );
  }

  if (sections.length === 0) {
    return reporterText;
  }

  return [reporterText, SEPARATOR, METADATA_HEADING, "", sections.join("\n\n")].join("\n\n");
}

/**
 * Audit SEC-EXT-04: reduce a page URL to origin + path unless the reporter
 * explicitly opted in to the full URL. Query strings and fragments often
 * carry OAuth codes/tokens, password-reset links, session ids or PII, and
 * task descriptions are visible to everyone on the project (and possibly
 * clients). A value that doesn't parse as a URL is returned unchanged
 * (nothing to strip from it).
 */
export function redactPageUrl(url: string, includeFull: boolean): string {
  if (includeFull) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.search && !parsed.hash) return url;
    return `${parsed.origin === "null" ? `${parsed.protocol}//` : parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}
