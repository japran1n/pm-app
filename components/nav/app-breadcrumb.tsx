"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbExtra } from "@/components/nav/breadcrumb-context";

// UX-09: static labels for the routes the header can name purely from the
// URL. A dynamic segment (a project id, a task key) is never guessable
// from the path alone — the page that owns it registers a human label via
// `useSetBreadcrumb` instead (see breadcrumb-context.tsx), which is spliced
// in wherever that segment would otherwise appear as a raw id.
const SEGMENT_LABELS: Record<string, string> = {
  "my-tasks": "My Tasks",
  projects: "Projects",
  calendar: "Calendar",
  timeline: "Timeline",
  search: "Search",
  time: "Time",
  requests: "Client requests",
  archive: "Archive",
  templates: "Templates",
  trash: "Trash",
  notifications: "Notifications",
  settings: "Settings",
  members: "Members",
  profile: "Profile",
  audit: "Audit log",
  board: "Board",
  list: "List",
  columns: "Columns",
  t: "Task",
};

// Segments that are a resolved id (uuid, or a project's short task-number
// suffix) rather than a nameable route — always covered by a registered
// extra crumb instead of being shown raw.
const ID_LIKE = /^[0-9a-f-]{8,}$|^[A-Z]+-\d+$/i;

export function AppBreadcrumb({
  workspaceSlug,
  workspaceName,
}: {
  workspaceSlug: string;
  workspaceName: string;
}) {
  const pathname = usePathname();
  const extra = useBreadcrumbExtra();

  const afterWorkspace = pathname
    .replace(/^\/w\/[^/]+/, "")
    .split("/")
    .filter(Boolean);

  const crumbs: { label: string; href?: string }[] = [
    { label: workspaceName, href: `/w/${workspaceSlug}` },
  ];

  let href = `/w/${workspaceSlug}`;
  let extraIndex = 0;
  for (const segment of afterWorkspace) {
    href += `/${segment}`;
    if (ID_LIKE.test(segment) && extra[extraIndex]) {
      crumbs.push(extra[extraIndex]);
      extraIndex += 1;
    } else if (SEGMENT_LABELS[segment]) {
      crumbs.push({ label: SEGMENT_LABELS[segment], href });
    }
    // An unrecognized, non-id segment (shouldn't normally happen) is
    // silently skipped rather than shown as a raw slug — a wrong-looking
    // crumb is worse than a short one.
  }

  // Any remaining registered crumbs (e.g. a task page nested one level
  // past its project) that the loop above didn't have an id segment to
  // anchor to.
  for (; extraIndex < extra.length; extraIndex += 1) {
    crumbs.push(extra[extraIndex]);
  }

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap overflow-hidden text-xs">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <BreadcrumbItem
              key={`${crumb.label}-${index}`}
              className={index === 0 ? "shrink-0" : "min-w-0"}
            >
              {isLast || !crumb.href ? (
                <BreadcrumbPage className="truncate">
                  {crumb.label}
                </BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink
                    render={
                      <Link href={crumb.href} className="truncate">
                        {crumb.label}
                      </Link>
                    }
                  />
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
