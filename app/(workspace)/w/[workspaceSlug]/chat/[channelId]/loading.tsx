import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the channel view's header + message-list
// + composer shape.
export default function ChatChannelLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-48" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-12 w-1/2 self-end" />
        <Skeleton className="h-12 w-3/5" />
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
