"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Bugfix (whitespace-below-short-content): see the original comment in
// this file's git history. WorkspaceMain decides per-route how <main>
// sizes and scrolls inside the workspace panel wrapper (the `flex flex-col
// flex-1 min-h-0` div in layout.tsx).
//
// For ALL routes: <main> fills the panel (flex-1 min-h-0) and scrolls
// within the panel (overflow-y-auto). The panel's rounded-lg border stays
// visible because the scroll happens inside it.
//
// Chat exception: the chat page has its own sticky header + pinned
// composer inside the scroll area, so no change needed — overflow-y-auto
// here is the same scroll container chat's internal components rely on.
export function WorkspaceMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname != null && /\/chat(\/|$)/.test(pathname);

  return (
    <main
      className={cn(
        "flex min-w-0 flex-1 flex-col min-h-0 overflow-x-hidden",
        isChat ? "overflow-y-auto" : "overflow-y-auto",
      )}
    >
      {children}
    </main>
  );
}
