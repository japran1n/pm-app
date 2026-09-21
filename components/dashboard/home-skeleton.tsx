function Pulse({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--secondary)] ${className ?? ""}`}
    />
  );
}

export function HomeSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <Pulse className="h-12 w-64" />
          <Pulse className="h-[180px] w-full" />
          <Pulse className="h-[260px] w-full" />
          <Pulse className="h-[140px] w-full" />
        </div>
        {/* Right column */}
        <div className="flex flex-col gap-4">
          <Pulse className="h-[140px] w-full" />
          <Pulse className="h-[160px] w-full" />
          <Pulse className="h-[120px] w-full" />
        </div>
      </div>
    </div>
  );
}
