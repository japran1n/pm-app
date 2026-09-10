// Mission 20260910-182104, F011 (AS-013, AS-016): derives a URL slug
// proposal from a page name.
//
// Nested path segments (AS-016, e.g. "/services/seo") are supported by
// treating "/" as a segment separator: each segment between slashes is
// slugified independently (lowercased, spaces -> hyphens, non
// alphanumeric/hyphen characters stripped), then rejoined with "/".
// Leading/trailing/duplicate slashes collapse away. This is the
// documented choice for "Services / SEO" -> "services/seo" (not
// "services-seo") -- a literal "/" in the input is treated as an
// intentional segment break, not punctuation to strip.
export function slugify(name: string): string {
  return name
    .split("/")
    .map((segment) =>
      segment
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter((segment) => segment.length > 0)
    .join("/");
}
