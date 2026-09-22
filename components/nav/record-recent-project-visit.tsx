"use client";

// F011 (SB-042): mounted once per project detail page (see that route's
// layout) purely to record "this project was visited" for the sidebar's
// recent-projects fallback. Renders nothing -- a Client Component only
// because `localStorage` (via lib/nav/recent-projects.ts) doesn't exist
// on the server, per that route's own Server Component layout.
import { useEffect } from "react";

import { recordRecentProjectVisit } from "@/lib/nav/recent-projects";

export function RecordRecentProjectVisit({ projectId }: { projectId: string }) {
  useEffect(() => {
    recordRecentProjectVisit(projectId);
  }, [projectId]);

  return null;
}
