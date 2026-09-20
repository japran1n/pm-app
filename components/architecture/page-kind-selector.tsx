"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { useArchitectureActions } from "@/lib/architecture/actions-context";
import { PageKindBadge } from "@/components/architecture/page-kind-badge";
import type { BoardPageKind } from "@/lib/queries/architecture";

// Mission 20260910-182104, F016 (AS-032): a page's kind can be changed
// after creation. Renders the existing PageKindBadge (F007) plus a small
// popover offering the three page kinds; selecting one calls
// changePageKind (lib/actions/architecture.ts) and refreshes the board.
//
// Mission 20260919-150607, F045 (AS-152, AS-153, AS-154): extended to also
// support a controlled value/onChange mode (mirrors
// section-kind-selector.tsx's contract) so CreatePageDialog can let a user
// pick a page_kind before a page (and therefore a taskId) exists yet.
// Existing taskId/kind callers are unaffected -- the two modes are a
// discriminated union on props.
const KINDS: BoardPageKind[] = ["static", "cms", "cms_template", "utility"];

type PersistedProps = {
  taskId: string;
  kind: BoardPageKind | null;
  value?: undefined;
  onChange?: undefined;
};

type ControlledProps = {
  value: BoardPageKind;
  onChange: (kind: BoardPageKind) => void;
  taskId?: undefined;
  kind?: undefined;
};

export function PageKindSelector(props: PersistedProps | ControlledProps) {
  const { changePageKind, readOnly } = useArchitectureActions();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const isControlled = props.onChange !== undefined;
  const resolved = isControlled ? props.value : (props.kind ?? "static");

  // Persisted mode is a board mutation -- not available read-only. The
  // controlled mode (CreatePageDialog) never reaches a read-only board
  // since create affordances don't render there at all.
  if (readOnly && !isControlled) {
    return <PageKindBadge kind={resolved} />;
  }

  function handleSelect(next: BoardPageKind) {
    setOpen(false);
    if (next === resolved) return;
    if (isControlled) {
      props.onChange(next);
      return;
    }
    startTransition(async () => {
      const result = await changePageKind(props.taskId, next);
      if (result.success) {
        router.refresh();
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Change page kind"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <PageKindBadge kind={resolved} />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-1 flex min-w-[96px] flex-col gap-0.5 rounded-md border bg-popover p-1 shadow-xs"
        >
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === resolved}
              onClick={() => handleSelect(option)}
              className={cn(
                "flex items-center rounded-sm px-1 py-1 text-left hover:bg-muted/50",
                option === resolved && "bg-muted/50",
              )}
            >
              <PageKindBadge kind={option} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
