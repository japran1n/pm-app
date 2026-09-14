"use client";

// F002 (missions/20260903-portal): a small in-page nav so the three
// project-settings routes (members, board columns, phases) can reach one
// another. This codebase has no existing "settings sub-nav" convention at
// either the workspace level (app/(workspace)/w/[workspaceSlug]/settings/)
// or the project level — `settings/columns/page.tsx` (F219) is reachable
// today only by direct URL. This feature's own spec calls for phases to be
// reachable "next to the existing settings entries" in
// `components/project-tabs.tsx`; since that component is the Board/List/
// Docs tab switcher and has no settings entries to sit next to (verified:
// no route anywhere links to `.../settings/columns`), this component is
// what those "settings entries" actually are — ProjectTabs gets one new
// "Settings" tab (linking to `.../settings`) and every settings route
// renders this nav so members/columns/phases can navigate to each other.
// See this feature's handoff for the full rationale.
//
// Styling/pattern mirrors app-sidebar.tsx's own Link + aria-current
// convention (cn() + bg-accent for the active item) — no new nav
// primitive introduced.

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ENTRIES = [
  { slug: "", label: "Members" },
  { slug: "columns", label: "Board columns" },
  // Custom fields: flexible, project-scoped extra fields on tasks, edited
  // once per project setup like board columns — same settings sub-nav
  // placement immediately beside it.
  { slug: "custom-fields", label: "Custom fields" },
  // Mission 20260914-portal-simplify, F011 (AS-020): phases feed the
  // Home overview's phase timeline -- named here so the team knows
  // editing this tab changes what the client sees on Home.
  { slug: "phases", label: "Phases", clientSees: "Home" },
  // F013 (missions/20260903-portal): "What we need from the client" — a
  // tab beside the phases settings, per that feature's own spec, reached
  // through this same sub-nav rather than a top-level project tab (a PM
  // edits this weekly, same cadence as phases, not the once-per-project
  // cadence board columns/members get).
  //
  // F011 (AS-020): deliverables feed the portal's "For you" materials
  // list (mission 20260914-portal-simplify, F006).
  { slug: "deliverables", label: "Deliverables", clientSees: "For you" },
  // F015 (missions/20260903-portal): scope, decisions and assumptions —
  // same weekly-edit cadence as deliverables, same reasoning for a
  // settings sub-nav tab rather than a top-level project tab.
  //
  // F011 (AS-020): the client-visible portal page for this content is
  // "Scope & decisions".
  { slug: "record", label: "Record", clientSees: "Scope & decisions" },
  // F018 (missions/20260903-portal): sold-hours budget setup (AS-033) —
  // same settings sub-nav placement as deliverables/record, reached from
  // here rather than a top-level project tab (a PM sets this up once per
  // period, not a daily surface, but it's still a project setting, not
  // buried further than deliverables/phases are).
  { slug: "budget", label: "Budget" },
  // F020 (missions/20260903-portal): metrics, baseline freeze and
  // before/after improvements (AS-039, AS-040, AS-041) — same settings
  // sub-nav placement as budget/record, set up once per phase then
  // measured against periodically, not a daily surface.
  //
  // F011 (AS-020): this feeds the portal's "Results" page.
  { slug: "measurement", label: "Measurement", clientSees: "Results" },
  // F022 (missions/20260903-portal): links and accounts (AS-049,
  // AS-050) — the site inventory a PM fills in once early and revisits
  // at handover, same settings sub-nav placement as record/budget.
  //
  // F011 (AS-020): this feeds the portal's "Your site" page.
  { slug: "site", label: "Site", clientSees: "Your site" },
  // F080 (missions/20260903-portal, hardening): the enable/disable
  // control for `projects.portal_enabled`, the readiness checklist, and
  // the launch/warranty editor — same settings sub-nav placement as
  // every other project-detail tab. Before this feature nothing in the
  // app could reach this control at all.
  //
  // F011 (AS-020): this is the tab that governs the portal itself, whose
  // landing page is now named "Home" (mission 20260914-portal-simplify,
  // F008).
  { slug: "portal", label: "Client portal", clientSees: "Home" },
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
    <nav aria-label="Project settings" className="flex flex-wrap gap-1">
      {ENTRIES.map((entry) => {
        const href = entry.slug ? `${basePath}/${entry.slug}` : basePath;
        const isActive = pathname === href;
        const clientSees = "clientSees" in entry ? entry.clientSees : undefined;
        return (
          <Link
            key={entry.slug || "members"}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-col gap-0.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {entry.label}
            {/* Mission 20260914-portal-simplify, F011 (AS-020): names the
                exact portal surface this tab's content feeds, so a PM
                doesn't have to guess where an edit here shows up for the
                client. */}
            {clientSees && (
              <span
                data-testid={`settings-nav-client-sees-${entry.slug || "members"}`}
                className="text-xs font-normal text-muted-foreground"
              >
                Client sees: {clientSees}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
