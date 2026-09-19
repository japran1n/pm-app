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
