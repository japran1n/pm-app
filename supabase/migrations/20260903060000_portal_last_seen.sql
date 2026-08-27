-- F2 (docs/client-dashboard-features-plan.md): "what changed since you were
-- last here", for a client who opens the portal once a week.
--
-- Generic column on workspace_members rather than a client-only table: a
-- "when did this member last look at the thing they're scoped to" concept
-- makes sense for any role in principle, and putting it on the membership
-- row avoids a one-row-per-client table for a single timestamp. Only the
-- portal (client role) writes to it today.
--
-- No RLS policy is added for this column: application code
-- (lib/queries/portal.ts) reads and writes it exclusively through the
-- admin client, after re-verifying the caller's own membership row
-- server-side — same pattern already used throughout this codebase's
-- Server Actions for admin-client writes gated by an application-level
-- permission check rather than a table policy.

alter table workspace_members
  add column if not exists portal_last_seen_at timestamptz;
