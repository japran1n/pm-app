"use client";

// F253 (AS-493): replay entry point, rendered on the profile settings
// page (the closest thing this app has to a "profile menu" -- there is
// no dropdown user menu yet, only the sidebar's link straight to
// /settings/profile, per components/nav/app-sidebar.tsx's F273 comment).

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { replayTour } from "@/lib/actions/onboarding-tour";

export function ReplayTourButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await replayTour();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // A full reload is the simplest way to get the workspace layout's
      // server-fetched `initialDismissed` prop to re-read the freshly
      // reset `tour_completed_at` -- no extra client-side state channel
      // needed between this page and <OnboardingTour>, which is mounted
      // in a different part of the tree (the layout, not this page).
      window.location.href = window.location.href.replace(
        "/settings/profile",
        "/",
      );
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      Replay onboarding tour
    </Button>
  );
}
