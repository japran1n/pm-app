"use client";

import { RouteError } from "@/components/route-error";

// F013 (missions/20260903-portal): route-segment error boundary for the
// `/projects/[projectId]/settings/deliverables` route. Mirrors the
// sibling settings/phases/error.tsx exactly.
export default function ProjectSettingsDeliverablesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
