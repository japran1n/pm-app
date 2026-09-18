# F22 — `lib/architecture/copy-brief.ts` + testovi

**Status:** [CLARIFIED]
**Estimate:** 40 min

## Task

Napravi `lib/architecture/copy-brief.ts` — čist modul bez React/DOM/fs, po uzoru na `lib/architecture/sitemap-io.ts`.

## Implementacija

```ts
// lib/architecture/copy-brief.ts
//
// Pure data-in, string-out. No React, no DOM, no fs.
// Estimates NEVER appear in the copy brief — it is a content document
// and the most likely candidate to be shared with clients.

import type { BoardPage } from '@/lib/queries/architecture';
import type { ArchitectureNodeDetails, NodeMeta } from '@/lib/architecture/types';

type BriefOpts = {
  pageSlug?: string; // if set, export only the page with this slug
};

function metaBlock(meta: NodeMeta | null): string {
  if (!meta) return '_No brief yet._';
  const lines: string[] = [];
  if (meta.intent) lines.push(`- Intent: ${meta.intent}`);
  if (meta.audience) lines.push(`- Audience: ${meta.audience}`);
  if (meta.primaryCta) lines.push(`- Primary CTA: ${meta.primaryCta}`);
  if (meta.tone) lines.push(`- Tone: ${meta.tone}`);
  if (meta.keywords.length > 0) lines.push(`- Keywords: ${meta.keywords.join(', ')}`);
  if (meta.copyStatus && meta.copyStatus !== 'not_started')
    lines.push(`- Copy status: ${meta.copyStatus}`);
  if (lines.length === 0) return '_No brief yet._';
  return lines.join('\n');
}

export function toCopyBriefMarkdown(
  pages: BoardPage[],
  details: ArchitectureNodeDetails,
  opts?: BriefOpts,
): string {
  const filteredPages = opts?.pageSlug
    ? pages.filter(p => p.pageSlug === opts.pageSlug)
    : pages;

  const lines: string[] = ['# Copy brief\n'];

  for (const page of filteredPages) {
    const pageMeta = details.get(page.id)?.meta ?? null;
    lines.push(`## ${page.title}  \`${page.pageSlug}\``);
    if (page.pageKind) lines.push(`- Kind: ${page.pageKind}`);
    lines.push('');
    lines.push(metaBlock(pageMeta));
    lines.push('');

    if (page.sections.length > 0) {
      lines.push('### Sections');
      page.sections.forEach((section, i) => {
        const sectionMeta = details.get(section.id)?.meta ?? null;
        const componentPart = section.component ? ` — component: \`${section.component.name}\`` : '';
        lines.push(`${i + 1}. **${section.title}** (${section.kind})${componentPart}`);
        const block = metaBlock(sectionMeta);
        if (block === '_No brief yet._') {
          lines.push('   - _No brief yet._');
        } else {
          block.split('\n').forEach(l => lines.push(`   ${l}`));
        }
      });
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function toCopyBriefJson(
  pages: BoardPage[],
  details: ArchitectureNodeDetails,
  opts?: BriefOpts,
): string {
  const filteredPages = opts?.pageSlug
    ? pages.filter(p => p.pageSlug === opts.pageSlug)
    : pages;

  const output = filteredPages.map(page => {
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
      sections: page.sections.map(section => {
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
```

## Testovi

Napravi `tests/unit/f022-copy-brief.test.ts`:

1. `test_markdown_omits_empty_fields` — meta sa samo intent postavljenim → samo intent linija, bez audience linije
2. `test_no_brief_yet_when_no_meta` — čvor bez meta → `_No brief yet._`
3. `test_estimates_never_in_brief` — čak i ako details ima estimates, brief output ne sadrži "minutes" niti "design" niti "development" ni "estimate" (regex assertion)
4. `test_json_roundtrip_meta_null` — čvor bez meta → `"meta": null` u JSON-u
5. `test_scope_slug_filters_to_one_page` — 3 stranice, scope na drugu → output sadrži samo drugu stranicu

## Definition of done

- [ ] Fajl postoji, čist (no React/DOM/fs/server imports)
- [ ] Testovi prolaze
- [ ] Regex assertion prolazi: nema "minutes" ni "estimate" ni disciplina u output-u
- [ ] `meta: null` za čvorove bez meta u JSON-u
- [ ] TypeScript build prolazi
