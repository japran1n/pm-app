import type { PersonEstimateVsLogged } from "@/lib/queries/time-entries";
import { formatDuration } from "@/lib/time/format-duration";
import { UserAvatar } from "@/components/user-avatar";

// F414: "who is over their estimate on this project" — the screen a lead
// opens before a status meeting, instead of adding it up from memory.
// Server-rendered, no client boundary: this is a read, nothing on it is
// interactive.
export function PersonEstimateRollup({
  rows,
  names,
}: {
  rows: PersonEstimateVsLogged[];
  names: Map<string, { name: string | null; email: string | null; avatarUrl: string | null }>;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-mini font-medium text-muted-foreground">
        Estimate vs. logged, by person
      </h2>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const person = names.get(row.userId);
          const over =
            row.estimateMinutes > 0 && row.loggedMinutes > row.estimateMinutes;
          return (
            <li
              key={row.userId}
              className="flex items-center gap-3 text-mini"
            >
              <UserAvatar
                person={{
                  id: row.userId,
                  name: person?.name ?? null,
                  email: person?.email ?? null,
                  avatarUrl: person?.avatarUrl ?? null,
                }}
                className="size-6 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">
                {person?.name ?? person?.email ?? "Unknown"}
              </span>
              <span
                className={
                  over
                    ? "font-mono text-micro tabular-nums text-destructive"
                    : "font-mono text-micro tabular-nums text-muted-foreground"
                }
              >
                {formatDuration(row.loggedMinutes)}
                {row.estimateMinutes > 0 &&
                  ` / ${formatDuration(row.estimateMinutes)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
