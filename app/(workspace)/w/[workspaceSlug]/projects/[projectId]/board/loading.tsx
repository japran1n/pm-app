import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the board page's real
// content shape -- a toolbar plus 4 fixed columns (To Do, In Progress,
// In Review, Done), each holding a few card-shaped skeletons, so the
// swap from skeleton to <Board> doesn't shift the page's height/width.
export default function BoardLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex flex-col gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
