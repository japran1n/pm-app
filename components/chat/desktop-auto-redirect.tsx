"use client";

// F4: `/chat` has no thread of its own -- on a desktop-sized viewport
// (where the layout's channel list panel is always visible alongside
// `children`) it should jump straight into the caller's first channel
// instead of leaving the thread pane blank. On a narrow/mobile viewport
// the channel list IS the useful screen at this route (see chat/layout.tsx
// and chat/page.tsx's own doc comments for why), so this only redirects
// above the same `md` breakpoint the rest of the chat layout switches on.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function DesktopAutoRedirect({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    if (mql.matches) {
      router.replace(href);
    }
  }, [href, router]);

  return null;
}
