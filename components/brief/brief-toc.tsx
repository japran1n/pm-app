"use client";

import { useEffect, useState } from "react";

import { slugifySection } from "@/lib/brief/slugify-section";
import { cn } from "@/lib/utils";

export type BriefTocSection = {
  name: string;
  answeredCount: number;
  totalCount: number;
};

// Lives in lib/ so server components can call it (this file is "use client").
export { slugifySection };

const sectionDomId = (name: string) => `section-${slugifySection(name)}`;

export function BriefToc({ sections }: { sections: BriefTocSection[] }) {
  const [active, setActive] = useState<string | null>(
    sections[0] ? sectionDomId(sections[0].name) : null,
  );

  const idsKey = sections.map((s) => sectionDomId(s.name)).join("|");

  useEffect(() => {
    if (!idsKey || typeof IntersectionObserver === "undefined") return;
    const ids = idsKey.split("|");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [idsKey]);

  if (sections.length <= 1) return null;

  const go = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  const items = sections.map((s) => {
    const id = sectionDomId(s.name);
    return { ...s, id, isActive: id === active };
  });

  return (
    <>
      <aside
        aria-label="Brief sections"
        className="sticky top-4 hidden lg:flex flex-col gap-1 w-48 shrink-0 self-start"
      >
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            aria-current={s.isActive ? "true" : undefined}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm duration-200 hover:bg-muted/50",
              s.isActive ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            <span className="truncate">{s.name}</span>
            <span className="font-mono text-xs shrink-0">
              {s.answeredCount}/{s.totalCount}
            </span>
          </button>
        ))}
      </aside>
      <nav
        aria-label="Brief sections"
        className="lg:hidden flex gap-2 overflow-x-auto pb-1 max-w-full"
      >
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            aria-current={s.isActive ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm duration-200",
              s.isActive
                ? "border-border-control-hover bg-muted/50 text-foreground font-medium"
                : "border-border text-muted-foreground",
            )}
          >
            <span>{s.name}</span>
            <span className="font-mono text-xs">
              {s.answeredCount}/{s.totalCount}
            </span>
          </button>
        ))}
      </nav>
    </>
  );
}
