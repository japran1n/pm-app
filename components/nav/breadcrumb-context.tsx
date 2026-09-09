"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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

// F035 (M2 review B4): this used to be a single-slot replace (`setExtra`)
// with unmount cleanup `setExtra([])`. F009 added a SECOND writer
// (components/docs/markdown-editor.tsx, announcing the doc title) that
// runs on the same route as the FIRST writer (components/project/
// project-breadcrumb.tsx, announcing the project name) whenever a doc is
// opened inside a project — `/w/<slug>/projects/<id>/docs/<docId>`. With a
// single slot, whichever writer's effect ran last simply overwrote the
// other's crumb, and unmounting either one wiped BOTH crumbs (the shared
// `[]` cleanup), even while the other writer was still mounted and had no
// reason to re-announce itself (its own deps hadn't changed).
//
// Fixed by keying writers into independent named slots instead of one
// shared value, so two callers can compose into `Project › Doc Title` and
// each one's unmount cleanup only clears its OWN slot. Rendering order is
// resolved by slot name (`SLOT_ORDER` below), not by effect-firing order
// (which is a React implementation detail — child effects commit before
// parent effects — and would silently reorder the crumbs depending on
// where in the tree each writer happens to sit).
type BreadcrumbSlotMap = Map<string, BreadcrumbItem[]>;

// Known slots in the order they should appear in the breadcrumb, outer to
// inner (mirrors the app's own route nesting: workspace > project > doc).
// A slot not listed here (a future writer nobody's updated this list for)
// is appended after all known slots, in the order it first registered —
// still deterministic, just not prioritized.
const SLOT_ORDER = ["project", "task", "doc"];

function flattenSlots(slots: BreadcrumbSlotMap): BreadcrumbItem[] {
  const known = SLOT_ORDER.filter((slot) => slots.has(slot));
  const unknown = Array.from(slots.keys()).filter((slot) => !SLOT_ORDER.includes(slot));
  const ordered = [...known, ...unknown];
  return ordered.flatMap((slot) => slots.get(slot) ?? []);
}

type BreadcrumbContextValue = {
  extra: BreadcrumbItem[];
  setSlot: (slot: string, items: BreadcrumbItem[]) => void;
  clearSlot: (slot: string) => void;
};

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [slots, setSlots] = useState<BreadcrumbSlotMap>(() => new Map());

  const setSlot = useCallback((slot: string, items: BreadcrumbItem[]) => {
    setSlots((prev) => {
      const next = new Map(prev);
      next.set(slot, items);
      return next;
    });
  }, []);

  const clearSlot = useCallback((slot: string) => {
    setSlots((prev) => {
      if (!prev.has(slot)) return prev;
      const next = new Map(prev);
      next.delete(slot);
      return next;
    });
  }, []);

  const extra = useMemo(() => flattenSlots(slots), [slots]);

  const value = useMemo(
    () => ({ extra, setSlot, clearSlot }),
    [extra, setSlot, clearSlot],
  );

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbExtra(): BreadcrumbItem[] {
  return useContext(BreadcrumbContext)?.extra ?? [];
}

/** Called by a page/layout that knows a human name the header can't derive
 * from the URL alone (a project's name, a task's key, a doc's title).
 * `slot` names this caller's own slot in the breadcrumb (see `SLOT_ORDER`
 * above) so multiple writers mounted at once compose instead of clobbering
 * each other — defaults to `"default"` for call sites that are the only
 * writer on their route. Clears only its OWN slot on unmount, so a sibling
 * writer that's still mounted keeps its crumb. */
export function useSetBreadcrumb(items: BreadcrumbItem[], slot: string = "default") {
  const ctx = useContext(BreadcrumbContext);
  const setSlot = ctx?.setSlot;
  const clearSlot = ctx?.clearSlot;
  const key = items.map((item) => `${item.label}|${item.href ?? ""}`).join(">");

  useEffect(() => {
    if (!setSlot || !clearSlot) return;
    setSlot(slot, items);
    return () => clearSlot(slot);
    // BUGFIX: the previous version depended on `ctx` (the whole context
    // VALUE object) instead of `setSlot`/`clearSlot` (the setState-derived
    // callbacks). BreadcrumbProvider builds a fresh `{ extra, setSlot,
    // clearSlot }` object every render — and it re-renders every time
    // `extra` changes, which is exactly what calling `setSlot` right here
    // causes. So `ctx` got a new identity on every run of this effect,
    // which re-triggered this same effect, which called `setSlot` again...
    // an infinite loop (visible in prod/dev as React's "Maximum update
    // depth exceeded", reproducible on every page under the workspace
    // layout, including ones that render no breadcrumb-consuming child
    // themselves — the loop lived one level up, in whichever page DID call
    // this hook). `setSlot`/`clearSlot` are wrapped in `useCallback` with
    // empty deps, so they're referentially stable for the lifetime of the
    // provider — depending on them directly instead of on `ctx` re-runs
    // this effect only when `slot` or the ANNOUNCED content (`key`)
    // actually changes, which was the original intent. `key` is a stable
    // serialization of `items`, per the same original intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSlot, clearSlot, slot, key]);
}
