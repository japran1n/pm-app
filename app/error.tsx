"use client";

import { RouteError } from "@/components/route-error";

// F257 (AS-500): root-level fallback for the app shell itself (outside
// any workspace). This is `app/error.tsx`, not `app/global-error.tsx` —
// it catches errors thrown by `app/page.tsx` and any route segment that
// doesn't have a closer error.tsx of its own, and still renders inside
// `app/layout.tsx` (so the root <html>/<body> and any chrome defined
// there survive), which is exactly the "root shell" fallback this
// feature's spec asks for. It does not need its own <html>/<body> tags
// (only `global-error.tsx` would, since that one replaces the root
// layout when the layout itself throws — out of scope here).
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <RouteError error={error} reset={reset} />
    </div>
  );
}
