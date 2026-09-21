import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the notifications page's
// narrow, centered column (`mx-auto max-w-2xl`) and its list of
// notification rows.
export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <Skeleton className="h-6 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
