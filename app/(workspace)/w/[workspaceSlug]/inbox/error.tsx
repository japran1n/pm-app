"use client";

import { RouteError } from "@/components/route-error";

// F013: route-segment error boundary for the `/inbox` route, same
// convention as every other route's own error.tsx (e.g.
// notifications/error.tsx) — reuses the shared `RouteError` body.
export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
