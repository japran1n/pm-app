-- Close the three unlisted anon grants that
-- tests/integration/f016i-anon-execute-catalog.test.ts has been failing on.
--
-- F016i's guard test derives its expectation from the catalog: any function in
-- `public` that `anon` can EXECUTE and that is not on its hand-reviewed
-- ANON_ALLOW_LIST is a defect. Three time-reporting functions have been
-- tripping it:
--
--   get_person_time_by_project(uuid, date, date)
--   get_person_time_daily(uuid, date, date)
--   get_workspace_time_by_person_and_project(uuid, date, date)
--
-- Severity is low, and worth stating precisely rather than overstating: all
-- three are SECURITY INVOKER, so an anon caller executes them as anon and RLS
-- returns zero rows. Nothing leaks today. What makes them a defect is that the
-- grant is unintended -- their two siblings, get_project_time_totals and
-- get_workspace_time_by_person, carry no anon grant at all. Three of five
-- were granted by accident.
--
-- Revoking is inert for real users (nothing in this schema is reachable as
-- anon; all 226 RLS policies target `authenticated` only) and it makes the
-- guard test green again, which matters more: a permanently red guard test is
-- one nobody reads.
--
-- This is deliberately narrow. It does NOT touch the 18 SECURITY DEFINER RLS
-- helpers on the allow-list, which must stay anon-callable so an anon query
-- against a protected table returns no rows instead of erroring with
-- "permission denied for function".

revoke execute on function public.get_person_time_by_project(uuid, date, date) from anon;
revoke execute on function public.get_person_time_daily(uuid, date, date) from anon;
revoke execute on function public.get_workspace_time_by_person_and_project(uuid, date, date) from anon;
