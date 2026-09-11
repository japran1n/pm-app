"use client";

// Mission 20260910-182104, F034 (AS-081, AS-082, AS-083): a right-side
// panel listing every one of the project's components, each with its
// instance count. Instance counts (including zero) come straight through
// from `getArchitectureBoard` (lib/queries/architecture.ts), which already
// starts from the full component list and defaults the count to 0 rather
// than inferring components only from linked sections -- so this panel
// never needs to compute counts itself, it just renders what it's given.
//
// F035 (component detail / navigation) and F036 (rename/delete) build on
// top of this panel later -- `onSelectComponent` is stubbed here as a
// no-op-friendly hook point so this file's public contract doesn't need to
// change again when those land.

import type { BoardComponent } from "@/lib/queries/architecture";

export function ComponentPanel({
  components,
  onClose,
  onSelectComponent,
}: {
  components: BoardComponent[];
  onClose?: () => void;
  onSelectComponent?: (component: BoardComponent) => void;
}) {
  return (
    <aside
      role="complementary"
      aria-label="Components"
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
          <li className="p-2 text-sm text-muted-foreground">No components yet.</li>
        ) : (
          components.map((component) => (
            <li key={component.id}>
              <button
                type="button"
                onClick={() => onSelectComponent?.(component)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm hover:border-border-control-hover hover:bg-muted/50"
              >
                <span>{component.name}</span>
                <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.07em] text-muted-foreground">
                  {component.instanceCount}{" "}
                  {component.instanceCount === 1 ? "instance" : "instances"}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
