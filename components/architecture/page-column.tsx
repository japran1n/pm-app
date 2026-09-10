import type { BoardPage } from "@/lib/queries/architecture";
import { PageKindSelector } from "@/components/architecture/page-kind-selector";
import { PageColumnHeader } from "@/components/architecture/page-column-header";
import { SortableSectionList } from "@/components/architecture/sortable-section-list";
import { DeletePageButton } from "@/components/architecture/delete-page-button";
import { AddSectionButton } from "@/components/architecture/add-section-button";

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
          <PageColumnHeader page={page} />
          <PageKindSelector taskId={page.id} kind={page.pageKind} />
          <DeletePageButton page={page} />
        </div>
        {page.description ? (
          <p className="text-xs text-muted-foreground">{page.description}</p>
        ) : null}
        <AddSectionButton pageTaskId={page.id} />
      </div>
      <div className="flex flex-col gap-2 p-3">
        <SortableSectionList sections={page.sections} pageId={page.id} />
      </div>
    </div>
  );
}
