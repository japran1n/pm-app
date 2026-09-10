import type { BoardPage } from "@/lib/queries/architecture";
import { PageKindBadge } from "@/components/architecture/page-kind-badge";
import { SectionCard } from "@/components/architecture/section-card";

// Mission 20260910-182104, F006 (AS-019, AS-020, AS-021): a single page
// column on the Architecture board. One column per page (AS-019), showing
// the page name (AS-020) and, when set, the page description (AS-021).
//
// The static/CMS badge (F007) and "Add section" trigger (F013) are left as
// empty placeholder slots in the sticky header so those features only need
// to fill them in, not restructure this layout.
//
// F008 (AS-025): sections render via SectionCard, showing the section
// name (and its linked component's name, when set).
export function PageColumn({ page }: { page: BoardPage }) {
  return (
    <div className="flex w-64 shrink-0 flex-col rounded-md border bg-card shadow-xs">
      <div className="sticky top-0 z-10 flex flex-col gap-1 rounded-t-md border-b bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{page.title}</p>
          <PageKindBadge kind={page.pageKind} />
        </div>
        {page.description ? (
          <p className="text-xs text-muted-foreground">{page.description}</p>
        ) : null}
        {/* F013: "Add section" trigger lands here. */}
        <div />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {page.sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}
