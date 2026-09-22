import { Skeleton } from "@/components/ui/skeleton";

// F013: loading state matching the Inbox page's narrow, centered column
// and tab row, same convention as notifications/loading.tsx.
export default function InboxLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <Skeleton className="h-6 w-40" />
      <div className="flex gap-2 border-b pb-2">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
