"use client";

// F243 (AS-465): "recent items" the palette shows when the query is
// empty. Storage decision (AUTONOMOUS_DECISION, recorded per the
// clarification's own Round B "simpler option, no new dependency, no
// second source of truth" rule, and per the feature spec's own Notes for
// clarification, which already flags this as acceptable): localStorage,
// NOT a new Supabase table.
//
// Why not a DB table (the board_swimlane_prefs / F226 precedent this
// feature spec explicitly points at): board_swimlane_prefs stores a
// small, bounded, INTENTIONAL per-project setting a user explicitly sets
// once. "Recently visited items" is a high-frequency, append-on-every-
// navigation event log — writing to Postgres on every palette selection
// would mean a network round trip (and a real migration, RLS policy, and
// FK-cascade surface) purely to remember UI browsing history that has no
// value once the browser/device changes. localStorage is the correct
// "no second source of truth, no new dependency" choice here precisely
// because this data is disposable, per-device convenience state, not
// data any other part of the product reads — the opposite of
// board_swimlane_prefs (which the board page itself reads server-side to
// avoid a first-paint flash). Explicitly NOT cross-device: a user on a
// second browser/device sees an empty recents list, which is the
// documented, accepted trade-off (feature spec's own Notes for
// clarification).
//
// Security: this hook stores ONLY a (type, id, visitedAt) pointer — never
// a name/title/key (see RecentItemPointer's own doc comment in
// lib/palette/palette-search-types.ts). Resolving a pointer into a
// renderable row happens exclusively via `resolveRecentItems`
// (lib/actions/palette-search.ts), a Server Action that re-checks the
// caller's CURRENT visibility on every read — so a stale pointer to a
// project/task the caller has since lost access to is silently dropped,
// and localStorage itself never becomes a way to learn a title/name the
// caller can no longer see.

import * as React from "react";

import type { RecentItemPointer } from "@/lib/palette/palette-search-types";
import { RECENT_ITEMS_CAP } from "@/lib/palette/palette-search-types";

function storageKey(workspaceId: string): string {
  return `pm-app:palette-recents:${workspaceId}`;
}

function readPointers(workspaceId: string): RecentItemPointer[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is RecentItemPointer =>
        !!entry &&
        typeof entry === "object" &&
        (entry.type === "project" || entry.type === "task") &&
        typeof entry.id === "string" &&
        typeof entry.visitedAt === "number",
    );
  } catch {
    // Corrupt/unavailable storage (private browsing, quota, manual
    // tampering) degrades to "no recents" rather than throwing — this is
    // disposable convenience state, never a source of truth for anything
    // security-relevant (see this file's header comment).
    return [];
  }
}

// The hook: exposes the caller's current raw pointer list for this
// workspace, plus a stable `addRecent` to record a new visit. Consumers
// (components/command/command-palette.tsx) pass the raw pointers to
// `resolveRecentItems` themselves to get back a visibility-checked,
// renderable result — this hook never talks to the server.
export function useRecentItems(workspaceId: string) {
  // Lazy initializer (runs once, during this component's own first
  // render — not in an effect) rather than useEffect+setState: this
  // hook's result is never rendered before the palette is first opened
  // (see components/command/command-palette.tsx's `hasRecents` gating),
  // so there is no server/client markup to keep in sync the way
  // components/theme-toggle.tsx's useSyncExternalStore trick guards
  // against for a value painted on every page. `window === undefined` on
  // the server simply yields `[]`, identical to the pre-hydration value a
  // useEffect-based read would have produced anyway.
  // `workspaceId` is not expected to change across this component's
  // lifetime (the palette is mounted once per workspace layout — see
  // components/command/command-palette.tsx), so a plain lazy initializer
  // is sufficient; there is no need to re-derive state from a changing
  // prop.
  const [pointers, setPointers] = React.useState<RecentItemPointer[]>(() =>
    readPointers(workspaceId),
  );

  const addRecent = React.useCallback(
    (item: { type: "project" | "task"; id: string }) => {
      if (typeof window === "undefined") return;

      const next: RecentItemPointer[] = [
        { type: item.type, id: item.id, visitedAt: Date.now() },
        ...readPointers(workspaceId).filter(
          (p) => !(p.type === item.type && p.id === item.id),
        ),
      ].slice(0, RECENT_ITEMS_CAP);

      try {
        window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
      } catch {
        // Storage unavailable/full: recents just don't persist this visit.
        // Not a functional failure — the palette still navigated.
      }

      setPointers(next);
    },
    [workspaceId],
  );

  return { pointers, addRecent };
}
