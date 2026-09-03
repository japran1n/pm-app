"use client";

import { RouteError } from "@/components/route-error";

// F010: route-segment error boundary for the `/approvals` route — same
// thin-wrapper convention as every other route's error.tsx (see e.g.
// my-tasks/error.tsx's own header comment for why the parent layout stays
// mounted outside this boundary).
export default function ApprovalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} />;
}
