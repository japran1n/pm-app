import { cn } from "@/lib/utils";
import type { BoardPage } from "@/lib/queries/architecture";
import { PageKindBadge } from "@/components/architecture/page-kind-badge";
import { sectionKindStaticTintClassName } from "@/lib/architecture/section-tint";

// Mission 20260910-182104, F037 (AS-091, AS-098): the portal's read-only
// counterpart to `components/architecture/page-column.tsx`. Same visual
// shell (sticky header, page name, kind badge, section list) but with
// every editing affordance removed -- no drag handle, no rename, no page
// kind selector, no delete button, no "Add section" trigger, and each
// section card is plain text (name + linked component name) with no
// link/create/delete controls. `page.sections` here is already the
// client-visible subset produced by `getArchitectureBoardForClient`
// (lib/queries/architecture.ts) -- this component does no filtering of
// its own (AS-098 is enforced at the query layer, not here).
//
// 20260915-status-sitemap-audit, F2 (AS-8, AS-10): section cards now carry
// the same CMS/component-linked visual tint `section-card.tsx` uses on the
// workspace board (CMS lilac wins over component green, same as the team
// side -- "where does this content come from" reads first) plus
// `data-component` so the shared `useComponentHover` hook / the existing
// `[data-hover-component]...[data-component]` CSS rules in app/globals.css
// light up shared component instances here exactly the same way, with no
// new CSS and no per-card React state. `data-page-id` on the column root
// mirrors sortable-section-list.tsx's convention so a Components panel's
// "appears on" click can scroll a page's column into view.
export function ClientPageColumn({ page }: { page: BoardPage }) {
  return (
    <div
      data-testid={`client-page-column-${page.id}`}
      data-page-id={page.id}
      className="flex w-64 shrink-0 flex-col rounded-md border bg-card shadow-xs"
    >
      <div className="sticky top-0 z-10 flex flex-col gap-1 rounded-t-md border-b bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{page.title}</p>
          <PageKindBadge kind={page.pageKind} />
        </div>
        {page.description ? (
          <p className="text-xs text-muted-foreground">{page.description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-3">
        {page.sections.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sections yet.</p>
        ) : (
          page.sections.map((section) => (
            <div
              key={section.id}
              data-testid={`client-section-card-${section.id}`}
              data-component={section.component?.id ?? undefined}
              data-section-kind={section.kind}
              className={cn(
                "w-full rounded-md border bg-card p-3 shadow-xs transition-colors",
                sectionKindStaticTintClassName(section),
              )}
            >
              <p className="truncate text-sm font-medium">{section.title}</p>
              {section.component ? (
                <p className="truncate text-xs text-muted-foreground">
                  {section.component.name}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
