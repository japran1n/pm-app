// Workspace-wide advance-notice banner: rendered once from the layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) above every page's own
// content, so a "Client Presentation" calendar block scheduled today or
// tomorrow is visible no matter which page a member lands on -- dashboard,
// calendar, notifications, anywhere under this workspace. See
// lib/calendar/client-presentation.ts's own file-header comment for why
// this is computed fresh on every request rather than a stored, dismissable
// notification.

import Link from "next/link";

import type { UpcomingClientPresentation } from "@/lib/calendar/client-presentation";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ClientPresentationBanner({
  presentations,
  workspaceSlug,
}: {
  presentations: UpcomingClientPresentation[];
  workspaceSlug: string;
}) {
  if (presentations.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="client-presentation-banner"
      className="flex flex-col gap-1 border-b border-red-200 bg-red-50 px-4 py-2 text-mini text-red-900"
    >
      {presentations.map((presentation) => (
        <div
          key={presentation.id}
          data-testid={`client-presentation-banner-item-${presentation.id}`}
          className="flex flex-wrap items-center gap-1"
        >
          <span aria-hidden>🔴</span>
          <span>
            Client presentation
            {presentation.projectName ? ` for ${presentation.projectName}` : ""}
            {" "}
            {presentation.trigger === "today" ? "today" : "tomorrow"} at{" "}
            {formatTime(presentation.startsAt)}
            {" "}
            — double-check staging before you present.
          </span>
          <Link
            href={`/w/${workspaceSlug}/calendar`}
            className="underline underline-offset-2 hover:no-underline"
          >
            View calendar
          </Link>
        </div>
      ))}
    </div>
  );
}
