"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Bugfix (whitespace-below-short-content): every page under
// app/(workspace)/w/[workspaceSlug]/layout.tsx used to render inside a
// `<main>` that was forced to exactly `h-svh` (the parent row's default
// `align-items: stretch` cross-axis behaviour stretches ANY flex item whose
// own height isn't otherwise overridden -- `flex-1` on `<main>` only
// affects the row's main axis, i.e. width, not this). A short page (e.g.
// project settings/phases) rendered its content near the top and left a
// large empty area filling the rest of the forced-full-height `<main>`
// box.
//
// F120 (AS-073, see workspace layout's own file-header comment) needs the
// OPPOSITE for chat: `<main>` capped exactly to the viewport with its own
// `overflow-y-auto`, so chat's internal message-list scroll container
// (components/chat/message-list.tsx) and its sticky header/composer never
// fight a second, page-level scroll container.
//
// Since these two needs are mutually exclusive CSS states of the SAME
// shared `<main>` element, and Server Component layouts can't read the
// active pathname to pick between them, this thin Client Component
// boundary is the one appropriate exception: it swaps `<main>`'s sizing
// class based on route, so the shared layout.tsx doesn't special-case any
// individual page, and every OTHER route --  short settings pages, long
// list/board/calendar pages alike -- gets the same content-sized default
// (`self-start`, no forced height) with the whole page/document scrolling
// naturally instead of an artificially tall, mostly-empty `<main>` box.
// Board's kanban columns and Calendar's grid were audited (grep for
// `h-full`/`min-h-0`+`flex-1` under their own component trees) and neither
// relies on `<main>` filling the viewport -- both already lay out and
// scroll (or, for Board, scroll the whole page) independent of `<main>`'s
// height, so only chat needs the exception below.
export function WorkspaceMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname != null && /\/chat(\/|$)/.test(pathname);

  return (
    <main
      className={cn(
        "flex min-w-0 flex-1 flex-col",
        isChat
          ? "min-h-0 overflow-y-auto"
          : "self-start overflow-visible",
      )}
    >
      {children}
    </main>
  );
}
