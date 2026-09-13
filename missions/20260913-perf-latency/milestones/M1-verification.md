# M1 verification — measured, not reasoned

Every worker in M1 wrote the same honest caveat: React's `cache()` does not
memoise under plain Vitest, so no unit test in this repo can observe whether
duplicate calls actually collapse. M1 therefore rested on reasoning. This is
the measurement that settles it.

Method: the worktree's own dev server on port 3100 (the user's port 3000 was
untouched), signed in as `demo+owner`, one isolated request to
`/w/goodguys-demo/projects/<id>/list`, bracketed by UTC timestamps, then the
Supabase edge logs queried for exactly that window.

## The headline

    /auth/v1/user   →   1 call

One. The audit measured **twelve** on this same route. Every duplicate
identity round trip is gone, and the one that remains is the one that has to
happen.

## Every call that request made

| Endpoint | Calls | Whose |
|---|---|---|
| `rpc/get_users_by_ids` | 4 | `resolvePeople`, called four separate times |
| `time_entries` | 3 | project layout rollup |
| `workspace_members` | 2 | |
| `profiles` | 2 | |
| `projects` | 2 | |
| `channel_members` | 2 | chat badge chain |
| `rpc/get_chat_channel_summaries` | 1 | chat badge chain |
| `channels` | 1 | chat badge chain |
| `rpc/get_open_task_counts` | 1 | |
| `project_favorites` | 1 | |
| `tasks` | 1 | |
| `task_types` | 1 | |
| `auth/v1/user` | 1 | |
| **total** | **22** | |

The audit counted 24–33 sequential trips on this route before the mission.

## Wall clock, best of three on a warm server

| Route | Baseline | After M1 |
|---|---|---|
| `/w/<slug>` | 2.01 s | 1.54 s |
| `/projects` | 1.53 s | 1.44 s |
| `/projects/<id>/list` | 1.61 s | 1.44 s |
| `/projects/<id>/board` | 2.26 s | 1.42 s |
| `/my-tasks` | 2.04 s | 1.38 s |
| `/calendar` | 2.62 s | 1.53 s |
| `/archive` | 1.42 s | 1.50 s |
| `/templates` | 1.52 s | 1.51 s |

**Read these with suspicion.** The baseline came off a different server
process on a different port, and this mission's own measurements of one
unchanged route varied by a factor of eight between passes. The call counts
above are the trustworthy number; these are the noisy one.

## What the numbers actually say

Two things, and the second matters more than the first.

**The duplicate-call problem is solved.** Twelve auth round trips became one,
and that is not an inference — it is a log line.

**A floor of roughly 1.4 s remains on every route, including empty ones.**
`/archive` and `/templates` render almost nothing and still cost as much as
the list. That floor is not the page; it is the workspace layout, which still
awaits its whole chain before returning any JSX. M1 removed the *duplicates*
inside that chain, but the chain's critical path is set by its slowest member,
and M1 was never going to shorten it. That is M3's and M4's job, and this
measurement is the evidence they are aimed correctly.

The call table names the next cuts precisely:

- **`resolvePeople` runs four times in one render** — four round trips where
  one would do. Added as F008b; it was not in the original plan because the
  audit rated it low-impact per call site and did not count the call sites.
- **The chat badge still costs four calls** (`channel_members` ×2,
  `channels`, `get_chat_channel_summaries`) to print one integer. F012 and
  F013 replace all four with one.
- **`time_entries` ×3** is the project layout's rollup, which F020 moves off
  the critical path.
