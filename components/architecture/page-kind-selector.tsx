"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { changePageKind } from "@/lib/actions/architecture";
import { PageKindBadge } from "@/components/architecture/page-kind-badge";
import type { BoardPageKind } from "@/lib/queries/architecture";

// Mission 20260910-182104, F016 (AS-032): a page's kind can be changed
// after creation. Renders the existing PageKindBadge (F007) plus a small
// popover offering the three page kinds; selecting one calls
// changePageKind (lib/actions/architecture.ts) and refreshes the board.
const KINDS: BoardPageKind[] = ["static", "cms", "utility"];

export function PageKindSelector({
  taskId,
  kind,
}: {
  taskId: string;
  kind: BoardPageKind | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const resolved = kind ?? "static";

  function handleSelect(next: BoardPageKind) {
    setOpen(false);
    if (next === resolved) return;
    startTransition(async () => {
      const result = await changePageKind(taskId, next);
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
        <PageKindBadge kind={kind} />
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
