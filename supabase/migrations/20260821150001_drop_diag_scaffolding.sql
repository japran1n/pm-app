-- Cleanup: drop throwaway diagnostic functions used while investigating the
-- projects-INSERT-RETURNING RLS regression fixed in the preceding migration.
-- These were never referenced by application code.
drop function if exists public.tmp_diag_policies();
drop function if exists public.tmp_diag_funcs();
