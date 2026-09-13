// F016 (AS-017): the first-run onboarding tour's own async server
// component. Fetches its own status (`getTourStatus`) instead of the
// layout awaiting it as part of the big `Promise.all` -- the layout wraps
// this in its own `<Suspense fallback={null}>` so a slow tour-status read
// never blocks the rest of the page. Renders the exact same
// `<OnboardingTour initialDismissed={...}>` the layout used to render
// directly, with the exact same "fails open to dismissed" fallback F253
// already documented.
import { getTourStatus } from "@/lib/actions/onboarding-tour";
import { OnboardingTour } from "@/components/onboarding/tour";

export async function TourFigure() {
  const tourStatusResult = await getTourStatus();
  const tourDismissed = tourStatusResult.ok ? tourStatusResult.dismissed : true;

  return <OnboardingTour initialDismissed={tourDismissed} />;
}
