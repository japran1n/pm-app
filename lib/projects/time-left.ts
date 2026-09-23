export type DueDateSource = {
  end_date?: string | null;
  target_launch_date?: string | null;
};

export function resolveDueDate(p: DueDateSource): string | null {
  return p.end_date || p.target_launch_date || null;
}

function utcDay(d: Date | string): number {
  const x = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / 86400000);
}

const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;

export function computeTimeLeft(dueDate: string | null | undefined, now: Date): string | null {
  if (!dueDate) return null;
  const diff = utcDay(dueDate) - utcDay(now);
  if (diff === 0) return "Due today";
  if (diff < 0) return `${plural(-diff, "day")} overdue`;
  if (diff >= 14) return `${plural(Math.floor(diff / 7), "week")} left`;
  return `${plural(diff, "day")} left`;
}
