// F015 (missions/20260903-portal, AS-043): the Scope view's "In the
// signed scope" / "Not included" pair, side by side (this feature's own
// spec, verbatim). An excluded item added by a change request shows
// which one (`changeRequestTitle`, resolved server-side by
// `getProjectScopeItems`).
import { Badge } from "@/components/ui/badge";
import type { ProjectScopeItem } from "@/lib/queries/project-records";

function ScopeColumn({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: ProjectScopeItem[];
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-border p-3 text-sm"
              data-testid="scope-item-row"
            >
              <p className="font-medium text-foreground">{item.title}</p>
              {item.description && (
                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              )}
              {item.source === "change_request" && (
                <Badge variant="outline" className="mt-2">
                  {item.changeRequestTitle
                    ? `Via: ${item.changeRequestTitle}`
                    : "Via change request"}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScopeLists({ items }: { items: ProjectScopeItem[] }) {
  const included = items.filter((item) => item.included);
  const excluded = items.filter((item) => !item.included);

  return (
    <div className="grid gap-6 sm:grid-cols-2" data-testid="scope-lists">
      <ScopeColumn
        title="In the signed scope"
        items={included}
        emptyLabel="Nothing recorded yet."
      />
      <ScopeColumn title="Not included" items={excluded} emptyLabel="Nothing excluded." />
    </div>
  );
}
