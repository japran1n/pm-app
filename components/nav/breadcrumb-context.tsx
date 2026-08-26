"use client";

import { createContext, useContext, useEffect, useState } from "react";

// UX-09: the header used to show nothing but the search box — on
// `/w/acme/projects/8f3c…/board` there was no on-screen indication of
// which project, or even which view, was open. `components/ui/
// breadcrumb.tsx` already ships in this repo and had zero call sites.
//
// A nested page (e.g. the project layout) knows its own project name; the
// header rendering the breadcrumb lives two layouts up and does not. Rather
// than prop-drilling project/task names through every intermediate layout,
// a page registers its own trailing crumbs via `useSetBreadcrumb` — the
// same "leaf announces itself upward" shape this codebase already uses for
// membership (components/auth/membership-provider.tsx).
export type BreadcrumbItem = { label: string; href?: string };

type BreadcrumbContextValue = {
  extra: BreadcrumbItem[];
  setExtra: (items: BreadcrumbItem[]) => void;
};

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [extra, setExtra] = useState<BreadcrumbItem[]>([]);
  return (
    <BreadcrumbContext.Provider value={{ extra, setExtra }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbExtra(): BreadcrumbItem[] {
  return useContext(BreadcrumbContext)?.extra ?? [];
}

/** Called by a page/layout that knows a human name the header can't derive
 * from the URL alone (a project's name, a task's key). Clears itself on
 * unmount so navigating away doesn't leave a stale crumb behind. */
export function useSetBreadcrumb(items: BreadcrumbItem[]) {
  const ctx = useContext(BreadcrumbContext);
  const key = items.map((item) => `${item.label}|${item.href ?? ""}`).join(">");

  useEffect(() => {
    if (!ctx) return;
    ctx.setExtra(items);
    return () => ctx.setExtra([]);
    // `key` is a stable serialization of `items`; re-running only when the
    // actual content changes avoids a render loop from a fresh array
    // identity on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key]);
}
