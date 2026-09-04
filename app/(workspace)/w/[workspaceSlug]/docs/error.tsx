"use client";

import { RouteError } from "@/components/route-error";

// F083: route-segment error boundary -- same thin-wrapper convention as
// every other route's error.tsx (see components/route-error.tsx header).
export default function DocsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
