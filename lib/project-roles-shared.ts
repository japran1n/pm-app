// F112 (missions/20260903-portal, six-star review Part 0/D): the
// `project_roles` vocabulary/labels/types, split out of
// lib/queries/project-roles.ts specifically so a Client Component
// (components/project/project-roles.tsx) can import them without also
// pulling in lib/queries/project-roles.ts's `createClient`/`createAdminClient`
// imports, which resolve to `@/lib/supabase/server` and transitively
// `next/headers` — a server-only API that throws at request time if a
// Client Component's module graph reaches it, even via a type-only-looking
// import (see tests/unit/server-client-boundary-imports.test.ts, and this
// feature's own handoff for the concrete 500 this caused before the
// split).

export const PROJECT_ROLE_VALUES = [
  "pm",
  "team_lead",
  "design_lead",
  "webflow_lead",
  "designer",
  "developer",
] as const;

export type ProjectRoleValue = (typeof PROJECT_ROLE_VALUES)[number];

// Team-lead-first ordering for the portal's "Your team" card (this
// feature's own spec: "Team lead first"). Everything else follows the
// order the agency itself named the jobs in
// (docs/client-portal-six-star-review.md Part 0/D).
export const PROJECT_ROLE_ORDER: ProjectRoleValue[] = [
  "team_lead",
  "pm",
  "design_lead",
  "webflow_lead",
  "designer",
  "developer",
];

export const PROJECT_ROLE_LABELS: Record<ProjectRoleValue, string> = {
  pm: "PM",
  team_lead: "Team lead",
  design_lead: "Design lead",
  webflow_lead: "Webflow lead",
  designer: "Designer",
  developer: "Developer",
};

export type ProjectRoleRow = {
  id: string;
  userId: string;
  role: ProjectRoleValue;
  note: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type ProjectTeamCandidate = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};
