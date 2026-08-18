// F073: the error-state "retry" control for the workspace home dashboard
// charts. Needs `useRouter().refresh()`, which only exists client-side, so
// this is its own tiny Client Component rather than pulling the whole
// Server Component page across the boundary.
"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function DashboardRetryButton() {
  const router = useRouter();

  return (
    <Button variant="outline" size="sm" onClick={() => router.refresh()}>
      Retry
    </Button>
  );
}
