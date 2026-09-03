"use client";

import { RouteError } from "@/components/route-error";

// F002 (missions/20260903-portal): route-segment error boundary for the
// `/projects/[projectId]/settings/phases` route. Mirrors the sibling
// settings/columns/error.tsx exactly — see that file's own doc comment
// for why this stays a thin wrapper around the shared `RouteError` body.
export default function ProjectSettingsPhasesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
