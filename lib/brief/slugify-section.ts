import { slugifySegment } from "@/lib/utils/slugify";

/**
 * Stable anchor slug for a section name, from the app's single slug
 * generator (lib/utils/slugify.ts). Latin diacritics are folded to ASCII;
 * other scripts (Cyrillic, CJK, ...) are preserved so they do not collapse
 * into a single fallback. Falls back to "section" only for names with no
 * letters or digits at all.
 */
export function slugifySection(name: string): string {
  return slugifySegment(name, { keepUnicodeLetters: true }) || "section";
}

/**
 * DOM ids (`section-<slug>`) for a list of section names, unique within the
 * list: colliding slugs get a numeric suffix (-2, -3, ...). Compute once per
 * render and share between the TOC and the section headings.
 */
export function uniqueSectionIds(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = `section-${slugifySection(name)}`;
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  });
}
