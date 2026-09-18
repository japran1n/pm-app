// lib/architecture/copy-brief.ts
//
// Mission 20260918-architecture-enrichment, F22: pure copy brief export.
// No React, no DOM, no fs. Same contract as lib/architecture/sitemap-io.ts.
//
// IMPORTANT: Estimates (minutes, discipline) NEVER appear in the copy brief.
// It is a content document and the most likely candidate to be shared with
// clients. Only meta fields are included.

import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, NodeMeta } from "@/lib/architecture/types";

type BriefOpts = {
  pageSlug?: string; // export only the page with this slug
};

function metaBlock(meta: NodeMeta | null): string {
  if (!meta) return "_No brief yet._";
  const lines: string[] = [];
  if (meta.intent) lines.push(`- Intent: ${meta.intent}`);
  if (meta.audience) lines.push(`- Audience: ${meta.audience}`);
  if (meta.primaryCta) lines.push(`- Primary CTA: ${meta.primaryCta}`);
  if (meta.tone) lines.push(`- Tone: ${meta.tone}`);
  if (meta.keywords.length > 0) lines.push(`- Keywords: ${meta.keywords.join(", ")}`);
  if (meta.copyStatus && meta.copyStatus !== "not_started")
    lines.push(`- Copy status: ${meta.copyStatus}`);
  if (lines.length === 0) return "_No brief yet._";
  return lines.join("\n");
}

export function toCopyBriefMarkdown(
  pages: BoardPage[],
  details: ArchitectureNodeDetails,
  opts?: BriefOpts,
): string {
  const filteredPages = opts?.pageSlug
    ? pages.filter((p) => p.pageSlug === opts.pageSlug)
    : pages;

  const lines: string[] = ["# Copy brief\n"];

  for (const page of filteredPages) {
    const pageMeta = details.get(page.id)?.meta ?? null;
    lines.push(`## ${page.title}  \`${page.pageSlug}\``);
    if (page.pageKind) lines.push(`- Kind: ${page.pageKind}`);
    lines.push("");
    lines.push(metaBlock(pageMeta));
    lines.push("");

    if (page.sections.length > 0) {
      lines.push("### Sections");
      page.sections.forEach((section, i) => {
        const sectionMeta = details.get(section.id)?.meta ?? null;
        const componentPart = section.component
          ? ` — component: \`${section.component.name}\``
          : "";
        lines.push(
          `${i + 1}. **${section.title}** (${section.kind})${componentPart}`,
        );
        const block = metaBlock(sectionMeta);
        if (block === "_No brief yet._") {
          lines.push("   - _No brief yet._");
        } else {
          block.split("\n").forEach((l) => lines.push(`   ${l}`));
        }
      });
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function toCopyBriefJson(
  pages: BoardPage[],
  details: ArchitectureNodeDetails,
  opts?: BriefOpts,
): string {
  const filteredPages = opts?.pageSlug
    ? pages.filter((p) => p.pageSlug === opts.pageSlug)
    : pages;

  const output = filteredPages.map((page) => {
    const pageMeta = details.get(page.id)?.meta ?? null;
    return {
      title: page.title,
      slug: page.pageSlug,
      kind: page.pageKind,
      meta: pageMeta
        ? {
            intent: pageMeta.intent,
            audience: pageMeta.audience,
            primaryCta: pageMeta.primaryCta,
            tone: pageMeta.tone,
            keywords: pageMeta.keywords,
            copyStatus: pageMeta.copyStatus,
          }
        : null,
      sections: page.sections.map((section) => {
        const sectionMeta = details.get(section.id)?.meta ?? null;
        return {
          title: section.title,
          kind: section.kind,
          component: section.component?.name ?? null,
          meta: sectionMeta
            ? {
                intent: sectionMeta.intent,
                audience: sectionMeta.audience,
                primaryCta: sectionMeta.primaryCta,
                tone: sectionMeta.tone,
                keywords: sectionMeta.keywords,
                copyStatus: sectionMeta.copyStatus,
              }
            : null,
        };
      }),
    };
  });

  return JSON.stringify(output, null, 2);
}
