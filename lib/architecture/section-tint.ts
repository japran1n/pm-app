import type { BoardSection } from "@/lib/queries/architecture";

// Mission 20260910-182104, F032 (AS-069): a section card is tinted by
// where its content comes from -- CMS-driven sections take the --cms-*
// lilac, sections linked to a shared component take the --component-*
// green, and CMS wins when a section is both ("where does this content
// come from" is the more load-bearing fact when reading a sitemap than
// "which component renders it").
//
// Extracted out of components/architecture/section-card.tsx by
// 20260915-status-sitemap-audit, F2 (AS-8) so the portal's read-only
// section cards (client-page-column.tsx, client-sitemap-tree.tsx) apply
// the exact same classnames the workspace board uses instead of a second,
// hand-copied string that could silently drift from it. section-card.tsx
// itself now calls this too, so there is exactly one place this logic
// lives.
export function sectionKindAccentClassName(
  section: Pick<BoardSection, "kind" | "component">,
): string {
  if (section.kind === "cms") {
    return "border-cms-border hover:border-cms-border-hover hover:bg-cms/10";
  }
  if (section.component) {
    return "border-component-border hover:border-component-border-hover hover:bg-component/10";
  }
  return "hover:border-border-control-hover";
}

// Mission 20260919-150607, F058 (AS-033): the client board's CMS tint must
// match the team board's exactly -- border-only at rest, a hover fill, no
// always-on background tint. This used to diverge from
// sectionKindAccentClassName (an always-on bg-cms/5 / bg-component/5 fill),
// which the M1 scrutiny validator flagged as a real visual mismatch. Now it
// simply delegates to the same classnames as the team board.
export function sectionKindStaticTintClassName(
  section: Pick<BoardSection, "kind" | "component">,
): string {
  return sectionKindAccentClassName(section);
}
