# F099: invite listUsers pagination

**Milestone:** M2 — Auth & Workspace (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F015
**Parent:** F015

## Assertion IDs covered
- AS-007

## Draft scope
- scrutiny-validator found the "already-active member" duplicate-invite check in inviteMember calls admin.auth.admin.listUsers() with no pagination — Supabase defaults to 50 users per page — so in a workspace/instance with >50 registered users, an already-active member can be silently re-invited, creating an inconsistent duplicate workspace_members row.
- Fix: paginate through all users, or (preferred if available) query by email directly via a more targeted Admin API call instead of listing all users and filtering client-side. Investigate whether Supabase Admin API supports a direct email-filtered lookup as of the current version (web search if uncertain) — prefer that over manual pagination if it exists.
- Add a test simulating a >50-user account list (can mock the admin client's listUsers response across pages) proving the duplicate-invite check still catches an active member correctly regardless of their position in the user list.

## Files (approximate)
lib/actions/workspaces.ts (~line 222, inviteMember), tests/integration/invite-member.test.ts

## Notes for clarification
Source: M2-scrutiny.md, "follow-up-invite-listUsers-pagination". Severity: major.
