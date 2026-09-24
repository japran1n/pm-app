"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const GROUPS = [
  {
    label: "People",
    entries: [
      { slug: "", label: "Members" },
    ],
  },
  {
    label: "Workflow",
    entries: [
      { slug: "columns", label: "Board columns" },
      { slug: "custom-fields", label: "Custom fields" },
      { slug: "phases", label: "Phases" },
      { slug: "deliverables", label: "Deliverables" },
    ],
  },
  {
    label: "Publishing",
    entries: [
      { slug: "site", label: "Site" },
      { slug: "portal", label: "Client portal" },
    ],
  },
  {
    label: "Reporting",
    entries: [
      { slug: "budget", label: "Budget" },
      { slug: "measurement", label: "Measurement" },
      { slug: "record", label: "Record" },
    ],
  },
] as const;

export function ProjectSettingsNav({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const pathname = usePathname();
  const basePath = `/w/${workspaceSlug}/projects/${projectId}/settings`;

  return (
    <nav
      aria-label="Project settings"
      className="flex w-48 shrink-0 flex-col gap-5 border-r border-border py-6 pr-2"
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {group.label}
          </p>
          {group.entries.map((entry) => {
            const href = entry.slug ? `${basePath}/${entry.slug}` : basePath;
            const isActive = pathname === href;
            return (
              <Link
                key={entry.slug || "members"}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-r before:bg-primary"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {entry.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
