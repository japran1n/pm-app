export interface Corpus {
  classes: string[]; // CSS class names from class="..." attributes
  cssVars: string[]; // CSS custom properties from --name declarations
  dataAttrs: string[]; // data-* attribute names (without "data-" prefix)
}

const CLASS_ATTR_RE = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi;
const CSS_VAR_RE = /--[a-zA-Z0-9_-]+/g;
const DATA_ATTR_RE = /\bdata-([a-zA-Z0-9_-]+)\s*=/gi;

/**
 * Builds an autocomplete corpus (class names, CSS custom properties, and
 * data-* attribute names) from a raw HTML document string. Pure string/regex
 * implementation (no DOM, no jsdom/cheerio) so it is safe to run anywhere.
 *
 * Never throws: malformed HTML simply yields whatever partial matches the
 * regexes find. Empty/falsy input returns all-empty arrays.
 */
export function buildCorpus(html: string): Corpus {
  const classes = new Set<string>();
  const cssVars = new Set<string>();
  const dataAttrs = new Set<string>();

  try {
    if (html) {
      let match: RegExpExecArray | null;

      CLASS_ATTR_RE.lastIndex = 0;
      while ((match = CLASS_ATTR_RE.exec(html)) !== null) {
        const value = match[2] ?? match[3] ?? '';
        for (const cls of value.split(/\s+/)) {
          if (cls) classes.add(cls);
        }
      }

      CSS_VAR_RE.lastIndex = 0;
      while ((match = CSS_VAR_RE.exec(html)) !== null) {
        cssVars.add(match[0]);
      }

      DATA_ATTR_RE.lastIndex = 0;
      while ((match = DATA_ATTR_RE.exec(html)) !== null) {
        if (match[1]) dataAttrs.add(match[1]);
      }
    }
  } catch {
    // Never throw: return whatever partial results were collected so far.
  }

  return {
    classes: Array.from(classes).sort(),
    cssVars: Array.from(cssVars).sort(),
    dataAttrs: Array.from(dataAttrs).sort(),
  };
}

const HOSTNAME_RE = /<link[^>]+href\s*=\s*["']https?:\/\/([^\/"'\s]+)/i;

/**
 * Best-effort extraction of a "hostname" fingerprint from a fetched HTML
 * document. Looks for the first absolute URL host referenced via a `<link
 * href="https://host/...">` tag (a reliable signal Webflow embeds, e.g.
 * canonical/stylesheet links). Returns null when no such URL is present.
 */
function extractHostname(html: string): string | null {
  try {
    const match = HOSTNAME_RE.exec(html ?? '');
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Decides whether the autocomplete corpus should be rebuilt from scratch
 * (F054, TH-180) rather than merged/accumulated. Returns true when:
 *  - the detected hostname changes between `oldHtml` and `newHtml`, or
 *  - the HTML length changes by more than 20% (heuristic for "substantially
 *    different" content even when no hostname could be detected).
 * Never throws.
 */
export function shouldResetCorpus(oldHtml: string, newHtml: string): boolean {
  try {
    const oldHost = extractHostname(oldHtml ?? '');
    const newHost = extractHostname(newHtml ?? '');
    if (oldHost && newHost && oldHost !== newHost) {
      return true;
    }

    const oldLen = (oldHtml ?? '').length;
    const newLen = (newHtml ?? '').length;
    if (oldLen === 0) {
      return newLen > 0;
    }
    const change = Math.abs(newLen - oldLen) / oldLen;
    return change > 0.2;
  } catch {
    return true;
  }
}

const CSS_CLASS_SELECTOR_RE = /\.(-?[_a-zA-Z][\w-]*)/g;
const CSS_CUSTOM_PROP_RE = /--[a-zA-Z0-9_-]+/g;

/**
 * Builds a corpus (classes + cssVars; no dataAttrs) from raw external CSS
 * text (F104). Extracts class selectors (`.foo`, `.foo.bar`, `.foo:hover`,
 * etc — the leading `.name` token of each) and custom property declarations
 * or references (`--name`). Never throws: malformed CSS simply yields
 * whatever partial matches the regexes find.
 */
export function buildCorpusFromCss(cssText: string): Corpus {
  const classes = new Set<string>();
  const cssVars = new Set<string>();

  try {
    if (cssText) {
      let match: RegExpExecArray | null;

      CSS_CLASS_SELECTOR_RE.lastIndex = 0;
      while ((match = CSS_CLASS_SELECTOR_RE.exec(cssText)) !== null) {
        if (match[1]) classes.add(match[1]);
      }

      CSS_CUSTOM_PROP_RE.lastIndex = 0;
      while ((match = CSS_CUSTOM_PROP_RE.exec(cssText)) !== null) {
        cssVars.add(match[0]);
      }
    }
  } catch {
    // Never throw: return whatever partial results were collected so far.
  }

  return {
    classes: Array.from(classes).sort(),
    cssVars: Array.from(cssVars).sort(),
    dataAttrs: [],
  };
}

/**
 * Merges any number of corpora into one: union of each field, deduplicated
 * and sorted. Never throws.
 */
export function mergeCorpora(...corpora: Corpus[]): Corpus {
  const classes = new Set<string>();
  const cssVars = new Set<string>();
  const dataAttrs = new Set<string>();

  for (const corpus of corpora) {
    if (!corpus) continue;
    for (const cls of corpus.classes ?? []) classes.add(cls);
    for (const v of corpus.cssVars ?? []) cssVars.add(v);
    for (const d of corpus.dataAttrs ?? []) dataAttrs.add(d);
  }

  return {
    classes: Array.from(classes).sort(),
    cssVars: Array.from(cssVars).sort(),
    dataAttrs: Array.from(dataAttrs).sort(),
  };
}
