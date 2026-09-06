-- Paket B (client-portal redesign): `projects.billing_model`, so a
-- fixed-price project can hide the Hours view in the CLIENT PORTAL only
-- (internal time tracking is unaffected -- see the app-layer gating in
-- components/portal/portal-sidebar.tsx and the portal /hours route).
--
-- Default is 'fixed_price' for both existing and new rows -- the safer
-- default per this feature's own decision: it hides a data surface
-- (hours) until a PM deliberately opts a project into 'hourly', rather
-- than defaulting every existing project to leaking hours data into a
-- portal nobody has reviewed for that yet.
--
-- RLS: verified by grepping every `CREATE POLICY ... on projects` in this
-- migrations directory (20260818004709_rls_projects.sql,
-- 20260821140526_project_visibility_rls_sweep.sql's
-- projects_select_active_members, 20260919010000_projects_portal_launch_role_gate.sql,
-- 20261017010000_f020b_projects_allowlist_guard.sql) -- every one is a
-- row-level `USING`/`WITH CHECK` predicate keyed on workspace membership
-- / project visibility / role, none of them enumerate columns. A new
-- column on `projects` is visible to exactly the same callers as every
-- other column already is; no new policy is needed here.

create type public.project_billing_model as enum ('hourly', 'fixed_price');

alter table public.projects
  add column billing_model public.project_billing_model not null default 'fixed_price';
