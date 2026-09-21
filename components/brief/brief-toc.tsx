"use client";

import { useEffect, useState } from "react";

import { slugifySection, uniqueSectionIds } from "@/lib/brief/slugify-section";
import { cn } from "@/lib/utils";

export type BriefTocSection = {
  /** DOM id of the section element; computed from `name` when omitted. */
  id?: string;
  name: string;
  answeredCount: number;
  totalCount: number;
};

// Lives in lib/ so server components can call it (this file is "use client").
export { slugifySection };

const BOTTOM_TOLERANCE_PX = 4;

function isAtPageBottom(): boolean {
  const root = document.documentElement;
  return (
    window.innerHeight + window.scrollY >=
    root.scrollHeight - BOTTOM_TOLERANCE_PX
  );
}

export function BriefToc({ sections }: { sections: BriefTocSection[] }) {
  const computed = uniqueSectionIds(sections.map((s) => s.name));
  const items = sections.map((s, i) => ({ ...s, id: s.id ?? computed[i] }));
  const idsKey = items.map((s) => s.id).join("|");

  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split("|");
    const last = ids[ids.length - 1];
    const visible = new Set<string>();
    let observer: IntersectionObserver | undefined;

    const update = () => {
      // Short last sections can never reach the observer's trigger band, so
      // when the page is scrolled to the bottom the last one wins.
      if (isAtPageBottom() && window.scrollY > 0) {
        setActive(last);
        return;
      }
      const first = ids.find((id) => visible.has(id));
      if (first) setActive(first);
    };

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target.id);
            else visible.delete(entry.target.id);
          }
          update();
        },
        { rootMargin: "0px 0px -60% 0px" },
      );
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    }
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [idsKey]);

  if (sections.length <= 1) return null;

  const go = (id: string) => {
    setActive(id);
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <nav
      aria-label="Brief sections"
      className="flex max-w-full gap-2 overflow-x-auto pb-1 lg:sticky lg:top-4 lg:w-48 lg:shrink-0 lg:flex-col lg:gap-1 lg:self-start lg:overflow-visible lg:pb-0"
    >
      <ul className="flex gap-2 lg:flex-col lg:gap-1">
        {items.map((s) => {
          const isActive = s.id === active;
          return (
            <li key={s.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => go(s.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-sm duration-200 hover:bg-muted/50 lg:border-transparent lg:px-2",
                  isActive
                    ? "border-border-control-hover bg-muted/50 text-foreground font-medium"
                    : "border-border text-muted-foreground",
                )}
              >
                <span className="truncate">{s.name}</span>
                <span className="font-mono text-xs shrink-0">
                  {s.answeredCount}/{s.totalCount}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
