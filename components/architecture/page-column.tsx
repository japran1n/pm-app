import type { BoardPage } from "@/lib/queries/architecture";

// Mission 20260910-182104, F006 (AS-019, AS-020, AS-021): a single page
// column on the Architecture board. One column per page (AS-019), showing
// the page name (AS-020) and, when set, the page description (AS-021).
//
// The static/CMS badge (F007) and "Add section" trigger (F013) are left as
// empty placeholder slots in the sticky header so those features only need
// to fill them in, not restructure this layout.
//
// Section titles render as a flat list for now -- the full section card
// (drag handle, component chip, etc.) lands in F008.
export function PageColumn({ page }: { page: BoardPage }) {
  return (
    <div className="flex w-64 shrink-0 flex-col rounded-md border bg-card shadow-xs">
      <div className="sticky top-0 z-10 flex flex-col gap-1 rounded-t-md border-b bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{page.title}</p>
          {/* F007: static/CMS badge lands here. */}
          <div />
        </div>
        {page.description ? (
          <p className="text-xs text-muted-foreground">{page.description}</p>
        ) : null}
        {/* F013: "Add section" trigger lands here. */}
        <div />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {page.sections.map((section) => (
          <div
            key={section.id}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {section.title}
          </div>
        ))}
      </div>
    </div>
  );
}
