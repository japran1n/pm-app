// F240 (AS-456): the timeline's zoom-level switcher -- three plain links
// (week/month/quarter), same "URL search params for anything shareable"
// pattern this file's own clarified implementation answer names, and the
// exact shape the page's own prev/today/next month buttons already use
// (`Button` with `nativeButton={false}` + `render={<Link .../>}`), so a
// zoomed timeline is bookmarkable/shareable with no client JS required
// for the control itself. A Server Component -- no interaction of its
// own beyond an anchor navigation, mirroring `TimelineScale`'s own "no
// interaction, pure derived markup" shape.

import Link from "next/link";

import { TIMELINE_ZOOM_LEVELS, type TimelineZoomLevel } from "@/lib/timeline/layout";
import { Button } from "@/components/ui/button";

const ZOOM_LABELS: Record<TimelineZoomLevel, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

export function TimelineToolbar({
  currentZoom,
  hrefForZoom,
}: {
  currentZoom: TimelineZoomLevel;
  hrefForZoom: (zoom: TimelineZoomLevel) => string;
}) {
  return (
    <div className="flex items-center gap-1" data-testid="timeline-zoom-toolbar" role="group" aria-label="Timeline zoom level">
      {TIMELINE_ZOOM_LEVELS.map((zoom) => (
        <Button
          key={zoom}
          variant={zoom === currentZoom ? "default" : "outline"}
          size="sm"
          nativeButton={false}
          render={
            <Link
              href={hrefForZoom(zoom)}
              aria-current={zoom === currentZoom ? "true" : undefined}
              data-testid={`timeline-zoom-${zoom}`}
            >
              {ZOOM_LABELS[zoom]}
            </Link>
          }
        />
      ))}
    </div>
  );
}
