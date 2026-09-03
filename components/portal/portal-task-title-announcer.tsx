"use client";

import { useSetPortalTitle } from "@/components/portal/portal-title-context";

// F006e (missions/20260903-portal, AS-004): announces the task-detail
// route's title -- the task's own title -- into the shell's topbar. The
// task page itself (`p/[projectId]/t/[taskId]/page.tsx`, a Server
// Component) already fetched `task` for its own `<h1>`; this relays that
// same title upward instead of the topbar re-fetching the row itself
// (which it can't -- see `portal-title-context.tsx`'s own header
// comment). Renders nothing.
export function PortalTaskTitleAnnouncer({ title }: { title: string }) {
  useSetPortalTitle(title);
  return null;
}
