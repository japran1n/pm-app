import type { BoardSection } from "@/lib/queries/architecture";

// Mission 20260910-182104, F008 (AS-025): a section card shows the
// section name. Also shows the linked component's name as secondary text
// when present -- the visual distinction (chip/border colour) between
// sections with and without a component lands in F027/F032; this card
// only needs to surface the plain text for now.
//
// `data-component` carries the linked component's id (or is omitted when
// there is none) so F033's board-wide hover-linking can select every
// section card sharing a component via `[data-component="<id>"]` once the
// board root sets `data-hover-component`.
export function SectionCard({ section }: { section: BoardSection }) {
  return (
    <div
      data-component={section.component?.id ?? undefined}
      className="w-full rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-border-control-hover"
    >
      <p className="truncate text-sm font-medium">{section.title}</p>
      {section.component ? (
        <p className="truncate text-xs text-muted-foreground">
          {section.component.name}
        </p>
      ) : null}
    </div>
  );
}
