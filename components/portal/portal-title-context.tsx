"use client";

import { createContext, useContext, useEffect, useState } from "react";

// F006e (missions/20260903-portal, AS-004): the task-detail route's
// title -- the task's own title, per this feature's own scope -- is only
// known to the Server Component page that fetches the task
// (`p/[projectId]/t/[taskId]/page.tsx`). `PortalTopbar` renders ABOVE
// that page in the tree (it's part of the shared shell layout) and has
// no `taskId` to fetch with itself, and client components in this app
// never query Supabase directly (this mission's own design constraint
// 7) -- so the title has to travel from the page up to the topbar some
// other way.
//
// This is the identical shape `components/nav/breadcrumb-context.tsx`
// (`useSetBreadcrumb`) already solves for the exact same reason, one
// level up in the app (a project detail layout announcing its project's
// name to the workspace header): "a nested page knows a human name the
// header can't derive from the URL alone... a page registers its own
// trailing crumb via a hook rather than prop-drilling it through every
// intermediate layout." See that file's own header comment and
// `components/project/project-breadcrumb.tsx` for the established
// pattern this mirrors.
type PortalTitleContextValue = {
  title: string | null;
  setTitle: (title: string | null) => void;
};

const PortalTitleContext = createContext<PortalTitleContextValue | null>(null);

export function PortalTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <PortalTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </PortalTitleContext.Provider>
  );
}

/** Read by `PortalTopbar`: a non-null value overrides the route-derived
 * title (`resolvePortalViewTitle`) for routes -- like task detail --
 * where the URL alone doesn't carry a human-readable title. */
export function usePortalTitleOverride(): string | null {
  return useContext(PortalTitleContext)?.title ?? null;
}

/** Called by a page that knows a title the shell can't derive from the
 * URL alone. Clears itself on unmount so navigating away doesn't leave a
 * stale title behind. */
export function useSetPortalTitle(title: string | null) {
  const ctx = useContext(PortalTitleContext);
  const setTitle = ctx?.setTitle;

  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
    // Depend on `setTitle` (React's own stable setState function), not
    // `ctx` (the whole context VALUE object `PortalTitleProvider`
    // rebuilds every render) -- the identical bugfix `useSetBreadcrumb`
    // already made, for the identical reason: depending on `ctx` here
    // would re-trigger this effect on every render this effect itself
    // causes, an infinite loop. See
    // `tests/unit/breadcrumb-context-no-loop.test.tsx` for the original
    // repro of that exact class of bug in the sibling hook. Unlike that
    // hook, this one's deps list already matches everything the effect
    // references (`setTitle`, `title`) with no eslint-disable needed.
  }, [setTitle, title]);
}
