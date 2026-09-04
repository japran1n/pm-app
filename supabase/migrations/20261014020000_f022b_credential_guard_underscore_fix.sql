-- F022 fix, caught by this feature's own unit test before commit: Stripe
-- key shapes are `sk_live_<...>` / `pk_test_<...>` — the underscore after
-- `sk_`/`pk_`/`ghp_` broke the original alnum-only run length count,
-- letting a real-looking Stripe secret key through both the CHECK and
-- the Zod refinement. Widened to `[a-z0-9_]` so the run tolerates the
-- underscores these formats actually use.

create or replace function public.looks_like_credential(value text)
returns boolean
language sql
immutable
as $$
  select value is not null and (
    value ~ '(?i)sk_[a-z0-9_]{10,}'
    or value ~ '(?i)pk_[a-z0-9_]{10,}'
    or value ~ '(?i)ghp_[a-z0-9_]{10,}'
    or value ~ '(?i)xox[a-z]-[a-z0-9-]{10,}'
    or value ~ '-----BEGIN'
    or value ~ '[A-Za-z0-9+/]{40,}={0,2}'
  );
$$;
