"use client";

import { useEffect, useRef, useState } from "react";

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
// After a click, the programmatic scroll must not overwrite the chosen entry.
const CLICK_SUPPRESS_MS = 800;
const now = () => Date.now();

/**
 * Nearest ancestor that actually scrolls (the app shell scrolls inside a
 * container, not the window). Null means the document/window scrolls.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

function isScrolledToBottom(root: HTMLElement | null): boolean {
  if (root) {
    return (
      root.scrollTop > 0 &&
      root.scrollTop + root.clientHeight >=
        root.scrollHeight - BOTTOM_TOLERANCE_PX
    );
  }
  const doc = document.documentElement;
  return (
    window.scrollY > 0 &&
    window.innerHeight + window.scrollY >= doc.scrollHeight - BOTTOM_TOLERANCE_PX
  );
}

export function BriefToc({ sections }: { sections: BriefTocSection[] }) {
  const computed = uniqueSectionIds(sections.map((s) => s.name));
  const items = sections.map((s, i) => ({ ...s, id: s.id ?? computed[i] }));
  const idsKey = items.map((s) => s.id).join("|");

  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const suppressUntil = useRef(0);

  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split("|");
    const last = ids[ids.length - 1];
    const visible = new Set<string>();
    let observer: IntersectionObserver | undefined;
    const scrollRoot = findScrollParent(document.getElementById(ids[0]));
    const scrollTarget: HTMLElement | Window = scrollRoot ?? window;

    const update = () => {
      if (now() < suppressUntil.current) return;
      const first = ids.find((id) => visible.has(id));
      // Short last sections can never reach the observer's trigger band, so
      // at the bottom pick the last intersecting section, else the last one.
      if (isScrolledToBottom(scrollRoot)) {
        const lastVisible = [...ids].reverse().find((id) => visible.has(id));
        setActive(lastVisible ?? last);
        return;
      }
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
        { root: scrollRoot, rootMargin: "0px 0px -60% 0px" },
      );
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    }
    scrollTarget.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      observer?.disconnect();
      scrollTarget.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [idsKey]);

  if (sections.length <= 1) return null;

  const go = (id: string) => {
    suppressUntil.current = now() + CLICK_SUPPRESS_MS;
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
