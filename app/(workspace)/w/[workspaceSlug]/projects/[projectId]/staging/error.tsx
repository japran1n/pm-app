"use client";

import { RouteError } from "@/components/route-error";

// F05 (SP-031): route-segment error boundary -- same thin-wrapper
// convention as every other route's error.tsx (see
// components/route-error.tsx header, and sibling hours/error.tsx).
export default function ProjectStagingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
