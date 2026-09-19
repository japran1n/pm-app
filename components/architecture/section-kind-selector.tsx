"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { BoardSectionKind } from "@/lib/queries/architecture";

// Mission 20260919-150607, F005 (AS-025, AS-026): mirrors
// page-kind-selector.tsx for sections, which only ever take two kinds
// (static or CMS-driven). Controlled component -- callers own the value
// and persist it via whatever action fits their context (e.g. a section
// update server action), matching the clarified spec's
// value/onChange/disabled prop contract rather than baking in a specific
// mutation.
export type SectionKind = BoardSectionKind;

const KINDS: SectionKind[] = ["static", "cms"];

const LABELS: Record<SectionKind, string> = {
  static: "Static",
  cms: "CMS",
};

function SectionKindBadge({ kind }: { kind: SectionKind }) {
  const isCms = kind === "cms";
  return (
    <span
      data-section-kind={kind}
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center rounded-full border px-[5.5px] py-[3px] text-[9px] font-medium tracking-[0.07em] whitespace-nowrap uppercase",
        isCms
          ? "border-[var(--cms-border)] bg-[var(--cms)]/10 text-[var(--cms-foreground)]"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {LABELS[kind]}
    </span>
  );
}

export function SectionKindSelector({
  value,
  onChange,
  disabled,
}: {
  value: SectionKind;
  onChange: (kind: SectionKind) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  function handleSelect(next: SectionKind) {
    setOpen(false);
    if (next === value) return;
    onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Change section kind"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <SectionKindBadge kind={value} />
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
              aria-selected={option === value}
              onClick={() => handleSelect(option)}
              className={cn(
                "flex items-center rounded-sm px-1 py-1 text-left hover:bg-muted/50",
                option === value && "bg-muted/50",
              )}
            >
              <SectionKindBadge kind={option} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
