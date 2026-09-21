"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
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
  calendar: "Planner",
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
  "status-templates": "Status templates",
  "task-types": "Task types",
  me: "My time",
  board: "Board",
  list: "List",
  hours: "Hours",
  staging: "Staging",
  architecture: "Architecture",
  brief: "Brief",
  columns: "Columns",
  t: "Task",
  watching: "Watching",
  team: "Team",
  chat: "Chat",
  approvals: "Approvals",
  "preview-as-client": "Preview as client",
  tools: "Tools",
  docs: "Docs",
  help: "Help",
  webflow: "HTML → Webflow",
  "code-editor": "Webflow Code Editor",
  sitemap: "Sitemap Builder",
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

  // When there are more than 3 crumbs, collapse middle ones into "..." so
  // the breadcrumb doesn't squeeze every segment to 1-2 chars. Show only
  // the workspace root, an ellipsis, and the current page — the page header
  // below already shows the project/section name, so losing it from the
  // crumb doesn't lose context.
  type DisplayCrumb = { label: string; href?: string } | null;
  const displayCrumbs: DisplayCrumb[] =
    crumbs.length > 3
      ? [crumbs[0], null, crumbs[crumbs.length - 1]]
      : crumbs;

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap overflow-hidden text-xs">
        {displayCrumbs.map((crumb, index) => {
          if (crumb === null) {
            return (
              <Fragment key="ellipsis">
                <BreadcrumbItem>
                  <BreadcrumbEllipsis />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            );
          }
          const isLast = index === displayCrumbs.length - 1;
          return (
            // BUGFIX: BreadcrumbSeparator renders its own <li> — the
            // shadcn Breadcrumb primitives are designed as a flat list of
            // sibling <li>s (item, separator, item, separator, ...), not
            // a separator nested INSIDE an item's <li>. Nesting one <li>
            // inside another is invalid HTML, and — like the identical
            // button-in-button issue found alongside this one tonight
            // (components/user-avatar-group.tsx) — React 19's hydration
            // validator now treats that as a hard, uncaught hydration
            // failure that breaks ALL client interactivity on the page,
            // not merely a console warning. Fixed by emitting the
            // separator as a SIBLING of BreadcrumbItem inside this
            // Fragment, matching shadcn's own documented usage.
            <Fragment key={`${crumb.label}-${index}`}>
              {/* First crumb (workspace) gets a min-width so it's always
                  visible; last crumb (current page) truncates rather than
                  disappearing. All items are capped so no single one
                  monopolises the available width. */}
              <BreadcrumbItem className={
                index === 0
                  ? "min-w-[3rem] max-w-[8rem]"
                  : isLast
                  ? "min-w-0 max-w-[10rem]"
                  : "min-w-[2rem] max-w-[6rem]"
              }>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage className="truncate">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={
                      <Link href={crumb.href} className="truncate">
                        {crumb.label}
                      </Link>
                    }
                  />
                )}
              </BreadcrumbItem>
              {!isLast && crumb.href && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
