// F005 (missions/20260903-portal): "How a page travels" — a static
// seven-step strip explaining the Pages view's own status vocabulary,
// copy taken verbatim from the prototype (this feature's own spec, itself
// derived from docs/client-portal-sixstar-plan.md §1.2's status table).
// Not data-driven — every page travels this same path, so this is a
// fixed legend below the table, not a per-row indicator.
//
// "Waiting on you" (step 2) is the one step where the ball is in the
// CLIENT's court — distinguished using the same waiting token every
// other client-facing "waiting on you" surface in this mission uses
// (`--status-waiting`, app/globals.css/F004), never a bespoke colour.
import { cn } from "@/lib/utils";

const STEPS = [
  "In design",
  "Waiting on you",
  "In build",
  "QA · development",
  "QA · design",
  "Ready to launch",
  "Live",
] as const;

const CLIENT_STEP = "Waiting on you";

export function PageTravelStrip() {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">How a page travels</h3>
      <ol
        data-testid="page-travel-strip"
        className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm"
      >
        {STEPS.map((step, index) => {
          const isClientStep = step === CLIENT_STEP;
          return (
            <li key={step} className="flex items-center gap-1">
              <span
                data-testid={isClientStep ? "page-travel-strip-client-step" : undefined}
                className={cn(
                  "rounded-full px-2.5 py-1",
                  isClientStep
                    ? "bg-status-waiting-bg font-medium text-status-waiting"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {step}
              </span>
              {index < STEPS.length - 1 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
