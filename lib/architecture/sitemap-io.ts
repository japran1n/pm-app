// Export/import for the Architecture sitemap. Pure data in, string out --
// no React, no DOM, no fs -- so the same module backs the client-side
// download button and any server-side generation.
//
// Hierarchy here is the slug path, exactly as lib/architecture/page-tree.ts
// derives it; nothing in this file invents a parent/child relationship the
// tree builder would not also derive.

import type { BoardPage } from "@/lib/queries/architecture";
import { buildPageTree, type PageTreeNode } from "@/lib/architecture/page-tree";
import { slugify } from "@/lib/utils/slugify";

export type ParsedPage = {
  path: string;
  title: string;
  kind?: string;
};

export type ParsedSitemap =
  | { ok: true; pages: ParsedPage[] }
  | { ok: false; error: string };

export type SitemapJson = {
  version: 1;
  pages: {
    path: string;
    title: string;
    kind: string | null;
    sections: string[];
    hasCmsSections?: true;
  }[];
};

/** Extensions that are assets or feeds, never pages of the sitemap. */
const NON_PAGE_EXTENSIONS = [".xml", ".json", ".jpg", ".png", ".pdf", ".css", ".js"];

/**
 * Returns the canonical slug path, or null when the input is not a page at
 * all -- an asset URL, or a line that slugifies away to nothing. Null and
 * "" are deliberately different: "" is the site root.
 */
function normalisePath(raw: string): string | null {
  let value = raw.trim();
  // Origins, query strings and fragments all address the same page.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const afterOrigin = value;
  value = value.split("#")[0].split("?")[0];
  // "" is the root only when the input really addressed the root ("/", a
  // bare origin, "/?utm=x") -- not when a junk line happened to begin with
  // a "?" and lost everything to the query strip.
  if (value.replace(/\/+/g, "") === "" && afterOrigin !== "" && !/^\/+([?#]|$)/.test(afterOrigin)) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // A stray "%" is not worth rejecting the whole line over.
  }
  value = value.replace(/^\/+|\/+$/g, "");

  // Checked before slugify, which strips the dot that identifies the file.
  const lower = value.toLowerCase();
  if (NON_PAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return null;

  if (value === "") return "";
  const slug = slugify(value);
  return slug === "" ? null : slug;
}

function humaniseSegment(segment: string): string {
  return segment
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function titleForPath(path: string): string {
  if (path === "") return "Home";
  const segments = path.split("/");
  const humanised = humaniseSegment(segments[segments.length - 1]);
  return humanised === "" ? "Home" : humanised;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pagePath(page: BoardPage): string {
  return page.pageSlug.trim().replace(/^\/+|\/+$/g, "");
}

export function toSitemapXml(pages: BoardPage[], baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const urls = pages
    .map((page) => {
      const path = pagePath(page);
      const loc = path === "" ? `${base}/` : `${base}/${path}`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
    })
    .join("\n");

  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ].join("\n");

  return urls === "" ? `${head}\n</urlset>\n` : `${head}\n${urls}\n</urlset>\n`;
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(pages: BoardPage[]): string {
  const rows = [["path", "title", "kind", "depth", "parent_path", "sections"]];

  for (const page of pages) {
    const path = pagePath(page);
    const segments = path === "" ? [] : path.split("/");
    const parent = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
    rows.push([
      path,
      page.title,
      page.pageKind ?? "",
      String(segments.length),
      parent,
      page.sections.map((section) => section.title).join("; "),
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function toMarkdown(pages: BoardPage[]): string {
  const root = buildPageTree(pages);
  const lines: string[] = [];

  function walk(node: PageTreeNode, depth: number) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- ${node.label} \`${node.key}\``);
    for (const child of node.children) walk(child, depth + 1);
  }

  walk(root, 0);
  return lines.join("\n");
}

export function toJson(pages: BoardPage[]): string {
  const payload: SitemapJson = {
    version: 1,
    pages: pages.map((page) => ({
      path: pagePath(page),
      title: page.title,
      kind: page.pageKind ?? null,
      sections: page.sections.map((section) => section.title),
      ...(page.sections.some((section) => section.kind === "cms")
        ? { hasCmsSections: true as const }
        : {}),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Appends `entry` plus every missing ancestor of its path, ancestors first,
 * so the resulting list never has a gap that would force page-tree.ts to
 * synthesise a folder the importer did not account for.
 */
function pushWithAncestors(
  out: ParsedPage[],
  seen: Set<string>,
  entry: ParsedPage,
): void {
  const segments = entry.path === "" ? [] : entry.path.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = segments.slice(0, i).join("/");
    if (seen.has(ancestor)) continue;
    seen.add(ancestor);
    out.push({ path: ancestor, title: titleForPath(ancestor) });
  }
  if (seen.has(entry.path)) return;
  seen.add(entry.path);
  out.push(entry);
}

function finalise(entries: ParsedPage[], emptyError: string): ParsedSitemap {
  const out: ParsedPage[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    pushWithAncestors(out, seen, entry);
  }
  if (out.length === 0) return { ok: false, error: emptyError };
  return { ok: true, pages: out };
}

function parseXml(text: string): ParsedSitemap {
  if (!/<urlset[\s>]/i.test(text)) {
    return { ok: false, error: "XML did not contain a <urlset> element." };
  }
  // Only <loc> children of <url> count; <xhtml:link href> alternates are
  // the same page in another language, not extra pages.
  const urlBlocks = text.match(/<url\b[\s\S]*?<\/url>/gi);
  if (!urlBlocks || urlBlocks.length === 0) {
    return { ok: false, error: "Sitemap XML contained no <url> entries." };
  }

  const entries: ParsedPage[] = [];
  for (const block of urlBlocks) {
    const loc = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    if (!loc) continue;
    const raw = unescapeXml(loc[1]).trim();
    if (raw === "") continue;
    const path = normalisePath(raw);
    if (path === null) continue;
    entries.push({ path, title: titleForPath(path) });
  }

  return finalise(entries, "Sitemap XML contained no usable <loc> values.");
}

function unescapeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseJson(text: string): ParsedSitemap {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Input looked like JSON but could not be parsed." };
  }

  const list = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && Array.isArray((data as SitemapJson).pages)
      ? (data as SitemapJson).pages
      : null;

  if (!list) {
    return { ok: false, error: "JSON did not contain a `pages` array." };
  }

  const entries: ParsedPage[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const path = normalisePath(item);
      if (path !== null) entries.push({ path, title: titleForPath(path) });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const rawPath = typeof record.path === "string" ? record.path : null;
    if (rawPath === null) continue;
    const path = normalisePath(rawPath);
    if (path === null) continue;
    const title = typeof record.title === "string" && record.title.trim() !== ""
      ? record.title.trim()
      : titleForPath(path);
    const kind = typeof record.kind === "string" && record.kind !== "" ? record.kind : undefined;
    entries.push(kind === undefined ? { path, title } : { path, title, kind });
  }

  return finalise(entries, "JSON contained no usable page entries.");
}

const BULLET = /^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Prose, not a path: spaces or capitals, and no slash-or-dot URL shape. */
function looksLikeTitle(content: string): boolean {
  if (content.startsWith("/") || content.includes("://")) return false;
  return /\s/.test(content) || /[A-Z]/.test(content);
}

function parseText(text: string): ParsedSitemap {
  const entries: ParsedPage[] = [];
  // Indent width varies between sources, so depth is tracked as a stack of
  // observed indents rather than assumed to be two spaces per level.
  const stack: { indent: number; path: string }[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") continue;

    const bullet = rawLine.match(BULLET);
    const indent = bullet ? bullet[1].replace(/\t/g, "  ").length : 0;
    let content = (bullet ? bullet[2] : rawLine).trim();
    if (content === "") continue;

    let explicit: string | null = null;
    const backticked = content.match(/`([^`]*)`\s*$/);
    if (backticked) {
      explicit = backticked[1];
      content = content.slice(0, backticked.index).trim();
    }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].path : "";

    let path: string | null;
    let title: string;

    if (explicit !== null) {
      path = normalisePath(explicit);
      if (path === null) continue;
      title = content !== "" ? content : titleForPath(path);
    } else if (bullet && looksLikeTitle(content)) {
      // A bullet whose text reads as prose (spaces, capitals) carries no
      // path of its own -- derive it from where it sits in the outline.
      const self = slugify(content);
      if (self === "") continue;
      path = parent === "" ? self : `${parent}/${self}`;
      title = content;
    } else {
      path = normalisePath(content);
      if (path === null) continue;
      title = titleForPath(path);
    }

    stack.push({ indent, path });
    entries.push({ path, title });
  }

  return finalise(entries, "No page paths were found in the input.");
}

export function parseSitemap(text: string): ParsedSitemap {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Input was empty." };

  if (trimmed.startsWith("<")) return parseXml(trimmed);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJson(trimmed);
  return parseText(trimmed);
}
