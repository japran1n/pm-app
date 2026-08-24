"use client";

import { RouteError } from "@/components/route-error";

// F257 (AS-500): route-segment error boundary for the `/my-tasks` route. Only
// catches errors thrown while rendering this segment (its page.tsx and
// anything below it) — the parent
// app/(workspace)/w/[workspaceSlug]/layout.tsx (sidebar/nav shell) is
// NOT inside this boundary and stays mounted, so an error here never
// blanks the whole app shell. Reuses the shared `RouteError` body
// (see that file's header) so every one of these route error.tsx files
// stays a thin wrapper rather than duplicating markup.
export default function MyTasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
