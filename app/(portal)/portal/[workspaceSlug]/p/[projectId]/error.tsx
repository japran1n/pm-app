"use client";

import { RouteError } from "@/components/route-error";

// P2-3: route-segment error boundary for every view nested under
// `p/[projectId]/` (overview, approvals, your-list, pages, hours,
// results, scope, site, brief, files, requests, conversation, t/
// [taskId], ...). Only catches errors thrown while rendering one of
// those segments -- the parent `p/[projectId]/layout.tsx` (the portal
// sidebar + topbar shell) is NOT inside this boundary and stays
// mounted, so a broken view never blanks the whole portal for a client.
// Reuses the same shared `RouteError` body the workspace app's own
// route error.tsx files use (see that component's header for why: a
// digest-only, no-stack-trace, `font-mono text-muted-foreground`
// error id, plus a "Try again" button that calls `reset()`).
export default function PortalProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
