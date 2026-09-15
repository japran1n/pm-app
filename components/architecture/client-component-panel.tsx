"use client";

// 20260915-status-sitemap-audit, F2 (AS-9): a trimmed, read-only sibling of
// `components/architecture/component-panel.tsx` for the portal Site map.
// Same two-pane shape (a list of components with instance counts, and a
// detail view listing every page a selected component appears on with
// click-to-navigate) but with every editing control removed -- no rename
// input, no delete dialog, no "create component" action anywhere.
//
// `components` here MUST already be AS-6-scoped (i.e. produced by
// `getArchitectureBoardForClient`, which only returns components
// referenced by at least one client-visible, non-deleted section) -- this
// component does no scoping of its own, same "filtering happens at the
// query layer, not here" convention `client-page-column.tsx` documents.
import { useState } from "react";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";

function ClientComponentListItem({
  component,
  onSelectComponent,
}: {
  component: BoardComponent;
  onSelectComponent?: (component: BoardComponent) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectComponent?.(component)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm hover:border-border-control-hover hover:bg-muted/50"
      >
        <span className="truncate">{component.name}</span>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.07em] text-muted-foreground">
          {component.instanceCount}{" "}
          {component.instanceCount === 1 ? "instance" : "instances"}
        </span>
      </button>
    </li>
  );
}

export function ClientComponentPanel({
  components,
  pages = [],
  onClose,
  onSelectComponent,
  onPageSelect,
  selectedComponentId,
}: {
  components: BoardComponent[];
  pages?: BoardPage[];
  onClose?: () => void;
  onSelectComponent?: (component: BoardComponent) => void;
  onPageSelect?: (pageId: string) => void;
  selectedComponentId?: string | null;
}) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  const effectiveSelectedId = selectedComponentId ?? internalSelectedId;
  const selectedComponent = effectiveSelectedId
    ? components.find((component) => component.id === effectiveSelectedId) ?? null
    : null;

  function selectComponent(component: BoardComponent) {
    setInternalSelectedId(component.id);
    onSelectComponent?.(component);
  }

  function backToList() {
    setInternalSelectedId(null);
  }

  if (selectedComponent) {
    // Every page on which this component appears among the client-visible
    // pages/sections this panel was handed -- a page qualifies if any of
    // its (already client-visible) sections links to this component.
    const pagesWithComponent = pages.filter((page) =>
      page.sections.some((section) => section.component?.id === selectedComponent.id),
    );

    return (
      <aside
        role="complementary"
        aria-label="Components"
        data-testid="client-component-panel-detail"
        className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-border bg-card shadow-xs"
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={backToList}
              aria-label="Back to components list"
              className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover"
            >
              Back
            </button>
            <h2 className="truncate text-sm font-medium">{selectedComponent.name}</h2>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close components panel"
              className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover"
            >
              Close
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[0.07em] text-muted-foreground">
            Appears on
          </h3>
          {pagesWithComponent.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              This component doesn&apos;t appear on any shared page.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {pagesWithComponent.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => onPageSelect?.(page.id)}
                    className="flex w-full items-center rounded-md border border-transparent px-2 py-2 text-left text-sm hover:border-border-control-hover hover:bg-muted/50"
                  >
                    {page.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label="Components"
      data-testid="client-component-panel"
      className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-border bg-card shadow-xs"
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-medium">Components</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close components panel"
            className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover"
          >
            Close
          </button>
        ) : null}
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {components.length === 0 ? (
          <li className="p-2 text-sm text-muted-foreground">No shared components yet.</li>
        ) : (
          components.map((component) => (
            <ClientComponentListItem
              key={component.id}
              component={component}
              onSelectComponent={selectComponent}
            />
          ))
        )}
      </ul>
    </aside>
  );
}
