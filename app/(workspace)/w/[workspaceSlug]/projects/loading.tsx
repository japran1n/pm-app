import { Skeleton } from "@/components/ui/skeleton";

// Loading state (per F027's clarified spec: shadcn Skeleton) shown by
// Next.js while the Server Component page below is fetching.
//
// F009 (PL-031): the skeleton card mirrors the real project card's three
// zones (components/projects/project-card.tsx) — a top zone (icon + title),
// an inner panel (due date / progress), and a footer row (avatars + open
// task count) — instead of a single undifferentiated block, so the loading
// state doesn't jump/reflow once real cards paint over it.
function ProjectCardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-md border bg-card p-4 shadow-xs">
      {/* Top zone: icon + title/description, mirrors CardHeader */}
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      {/* Inner panel: due date / progress, mirrors the bg-card rounded-lg panel */}
      <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      {/* Footer row: avatars + open task count */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export default function ProjectsLoading() {
  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <ProjectCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
