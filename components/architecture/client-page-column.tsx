import type { BoardPage } from "@/lib/queries/architecture";
import { PageKindBadge } from "@/components/architecture/page-kind-badge";

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
export function ClientPageColumn({ page }: { page: BoardPage }) {
  return (
    <div
      data-testid={`client-page-column-${page.id}`}
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
              className="w-full rounded-md border bg-card p-3 shadow-xs"
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
