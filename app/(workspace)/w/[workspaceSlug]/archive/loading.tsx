import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state shown by Next.js while
// app/.../archive/page.tsx is fetching, shaped like its real content —
// a header line plus a grid of project cards — so the swap from
// skeleton to content doesn't shift layout.
export default function ArchiveLoading() {
  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
