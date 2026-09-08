// F019 (missions/20260903-portal, AS-038): "every category shown has a
// stated value" -- horizontal bars, single hue (the brand colour, the
// same token the burn-down chart's Used series uses), each with a direct
// numeric label. Identity comes from the row's own text label, so no
// categorical palette exists here to invent one from -- matching
// status-distribution.tsx's identical "text label AND colour, never
// colour alone" convention, minus the colour-per-bucket part since a
// single hue carries no identity to begin with.
//
// "Uncategorised is shown as its own row named 'Uncategorised', never
// silently folded into another" -- `project_hours_client`'s own SQL
// already does `coalesce(work_category, 'uncategorised')` (F017,
// 20261010020000, line ~86), so this component only has to label that
// literal bucket key, not invent the fold itself.
import type { ClientHoursCategory } from "@/lib/queries/hours";

const CATEGORY_LABELS: Record<string, string> = {
  design: "Design",
  development: "Development",
  content_seo: "Content / SEO",
  pm: "PM",
  qa: "QA",
  uncategorised: "Uncategorised",
};

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function HoursByCategory({ categories }: { categories: ClientHoursCategory[] }) {
  if (categories.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
        <h2 className="text-mini font-semibold text-foreground">By category</h2>
        <p className="text-mini text-muted-foreground" data-testid="hours-by-category-empty">
          No billable hours logged yet.
        </p>
      </div>
    );
  }

  const sorted = [...categories].sort((a, b) => b.minutes - a.minutes);
  const maxMinutes = Math.max(...sorted.map((c) => c.minutes), 1);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <h2 className="text-mini font-semibold text-foreground">By category</h2>
      <dl className="flex flex-col gap-2.5" data-testid="hours-by-category">
        {sorted.map((category) => (
          <div key={category.workCategory} className="flex items-center gap-3">
            <dt className="w-28 shrink-0 truncate text-mini text-muted-foreground">
              {categoryLabel(category.workCategory)}
            </dt>
            <div className="h-2.5 min-w-0 flex-1 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${(category.minutes / maxMinutes) * 100}%` }}
              />
            </div>
            <dd className="w-14 shrink-0 text-right text-mini font-medium tabular-nums">
              {minutesToHours(category.minutes)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
