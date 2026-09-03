"use client";

// F003 (missions/20260903-portal): sign-out for the portal sidebar
// footer, with the same pending-disabled state
// `components/nav/app-sidebar.tsx`'s own `SignOutButton` already
// established (F256/AS-499) -- a bare `<form action={signOut}>` has no
// pending affordance and can be double-submitted by a fast double-click.
// A small standalone component rather than importing the team app's own
// `SignOutButton` directly: that component pulls in
// `components/nav/app-sidebar.tsx`'s full module graph (membership
// provider, notification bell, workspace switcher) for one button, and
// its `text-sidebar-foreground/70` styling is tuned for that sidebar's
// own token usage -- this one is identical in behaviour, sized for the
// portal's compact footer row instead.
import { useTransition } from "react";
import { LogOut, Loader2 } from "lucide-react";

import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await signOut();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={handleClick}
      className="justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <LogOut className="size-4" aria-hidden="true" />
      )}
      Sign out
    </Button>
  );
}
