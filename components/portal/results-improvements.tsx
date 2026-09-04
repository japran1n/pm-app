// F021 (missions/20260903-portal, AS-042): the "Improvements" list --
// area, explanation, and before/after images where they exist. Server
// Component (no interactivity needed): signed URLs are resolved once, in
// the page, by `getImprovementImageSignedUrl` (lib/actions/metrics.ts) and
// passed down already-resolved, same "resolve once per request, pass data
// down" shape the rest of this portal's server-rendered pages use.
//
// This feature's own spec is explicit that this section "must not require
// images to be worth reading" -- the explanation renders unconditionally,
// full width, and the image pair is additive below it, never a
// prerequisite for the text.
export type ResolvedImprovement = {
  id: string;
  area: string;
  explanation: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
};

export function ResultsImprovements({ improvements }: { improvements: ResolvedImprovement[] }) {
  if (improvements.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground">Improvements</h2>
        <p className="text-sm text-muted-foreground" data-testid="results-improvements-empty">
          Nothing has been logged here yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
      <h2 className="text-sm font-semibold text-foreground">Improvements</h2>
      <ul className="flex flex-col gap-5" data-testid="results-improvements-list">
        {improvements.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 border-b border-border/50 pb-5 last:border-0 last:pb-0">
            <h3 className="text-sm font-medium text-foreground">{item.area}</h3>
            <p className="text-sm text-muted-foreground">{item.explanation}</p>
            {(item.beforeImageUrl || item.afterImageUrl) && (
              <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="results-improvement-images">
                {item.beforeImageUrl && (
                  <figure className="flex flex-col gap-1">
                    <figcaption className="text-xs text-muted-foreground">Before</figcaption>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived Storage URL, not a static asset next/image can optimise */}
                    <img
                      src={item.beforeImageUrl}
                      alt={`${item.area} — before`}
                      className="w-full rounded-md border border-border object-cover"
                    />
                  </figure>
                )}
                {item.afterImageUrl && (
                  <figure className="flex flex-col gap-1">
                    <figcaption className="text-xs text-muted-foreground">After</figcaption>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived Storage URL, not a static asset next/image can optimise */}
                    <img
                      src={item.afterImageUrl}
                      alt={`${item.area} — after`}
                      className="w-full rounded-md border border-border object-cover"
                    />
                  </figure>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
