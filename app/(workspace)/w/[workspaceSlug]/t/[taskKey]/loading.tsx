import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state for the /t/[taskKey] short-link resolver. This
// route never renders lasting content itself -- it always redirects to
// the board deep-link or 404s -- but it does sequential Supabase lookups
// first (resolveTaskIdByKey, then getTaskDetail), so a brief skeleton
// avoids an apparent hang on a URL people paste to each other.
export default function TaskByKeyLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
