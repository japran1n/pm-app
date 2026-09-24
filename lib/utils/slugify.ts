// The app's ONE slug generator. Every place that derives a slug from
// human text (page slugs, workspace slugs, brief section anchors, export
// file names) goes through `slugifySegment` so the same name always
// produces the same slug.
//
// Transliteration: Latin letters with diacritics fold to ASCII via Unicode
// NFKD + stripping combining marks (å ä → a, ö → o, é → e, č → c, ...), and
// letters that do not decompose are mapped explicitly (ß → ss, æ → ae,
// ø → o, đ → d, ...). The old ASCII-only regexes deleted these letters
// outright, so "Om oss för företag" became "om-oss-fr-fretag".
//
// Only NEW slugs are generated here — callers never re-slugify a slug that
// is already stored (workspace slugs, page slugs), so existing URLs keep
// resolving.

const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  ł: "l",
  Ł: "l",
  ı: "i",
};

const TRANSLITERATION_PATTERN = new RegExp(`[${Object.keys(TRANSLITERATIONS).join("")}]`, "g");

export type SlugifyOptions = {
  /** Keep letters/digits from non-Latin scripts (Cyrillic, CJK, ...)
   * instead of dropping them. Used for in-page anchors, never for URLs. */
  keepUnicodeLetters?: boolean;
};

/** Slugifies one segment: no "/" survives. May return "". */
export function slugifySegment(text: string, options: SlugifyOptions = {}): string {
  const disallowed = options.keepUnicodeLetters ? /[^\p{L}\p{N}]+/gu : /[^a-z0-9]+/g;
  return text
    .replace(TRANSLITERATION_PATTERN, (char) => TRANSLITERATIONS[char] ?? char)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(disallowed, "-")
    .replace(/^-+|-+$/g, "");
}

// Mission 20260910-182104, F011 (AS-013, AS-016): page slug proposal from a
// page name. A literal "/" is an intentional segment break ("Services /
// SEO" -> "services/seo"); leading/trailing/duplicate slashes collapse.
export function slugify(name: string): string {
  return name
    .split("/")
    .map((segment) => slugifySegment(segment))
    .filter((segment) => segment.length > 0)
    .join("/");
}
