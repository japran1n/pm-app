# Discovery Round 1

_Captured: 2026-08-17T21:10:00Z_  _Adaptations from defaults: none (standard web-app baseline applies)_
_Answered by: orchestrator, on the user's behalf per explicit standing authorization — no direct user Q&A this mission._

## A. Users & Access

**1. Who are the primary users?**
- (a) Internal team only          ← chosen
- (b) External customers (B2C or B2B)
- (c) Public / anonymous OK
- (d) Mixed — some signed-in, some public

Rationale: PM tool for a team, not a public product.

**2. Expected user count at v1?**
- (a) <10                          ← chosen
- (b) 10–1,000
- (c) 1,000–100,000
- (d) >100,000

Rationale: solo/small-team MVP.

**3. Auth method?**
- (a) email + password
- (b) magic link / passwordless    ← chosen
- (c) OAuth (Google/GitHub/etc)
- (d) SSO / SAML (enterprise)

Rationale: Supabase Auth magic link is the lowest-friction, no-password-storage
option for a small internal tool; Google OAuth added as a secondary option in
round 2, not primary here.

**4. Role model?**
- (a) single role
- (b) 2–3 roles (user/admin)       ← chosen
- (c) granular RBAC
- (d) per-resource permissions

Rationale: workspace owner/admin vs member is enough for MVP; matches the
reference app's ProjectManager/ProductOwner/member notions without over-building.

**5. Signup model?**
- (a) open self-signup
- (b) invite-only                  ← chosen
- (c) admin-provisioned
- (d) waitlist

Rationale: internal team tool — workspace owner invites members by email.

## B. Data

**6. Primary data store?**
- (a) Postgres                     ← chosen
- (b) MySQL
- (c) SQLite
- (d) NoSQL (Mongo/DynamoDB)

Rationale: fixed by the Supabase constraint.

**7. Data volume at v1?**
- (a) <1 GB                        ← chosen
- (b) 1–100 GB
- (c) 100 GB–1 TB
- (d) >1 TB

**8. Real-time needs?**
- (a) none
- (b) polling is fine
- (c) WebSockets/SSE for some features   ← chosen
- (d) real-time is core

Rationale: live task/board updates are the one feature that makes a PM tool
feel alive for a small team; Supabase Realtime on `tasks`/`comments` tables
covers it without building a Realtime-as-core architecture.

**9. File/media storage?**
- (a) none
- (b) small files (<10 MB)         ← chosen
- (c) large files / video
- (d) third-party (S3 / Cloudinary)

Rationale: task attachments are small documents/screenshots; Supabase Storage
buckets cover this directly, replacing the reference app's S3 setup.

**10. Data retention / deletion?**
- (a) keep forever
- (b) soft delete only              ← chosen
- (c) hard delete after period
- (d) per-user export + delete (GDPR-style)

Rationale: soft delete (`deleted_at`) on tasks/projects avoids accidental
data loss and is the cheapest correct default; matches the corrections
list from the reverse-engineering pass.

## C. Interface

**11. Primary interface?**
- (a) web app                      ← chosen
- (b) native mobile
- (c) CLI
- (d) API only

**12. Rendering strategy?**
- (a) SSR (Next/Remix)             ← chosen
- (b) SPA (React/Vue)
- (c) static + progressive
- (d) classic server-rendered

Rationale: fixed by the Next.js constraint; App Router with Server Components
+ Server Actions where practical.

**13. Design system?**
- (a) Tailwind + shadcn/ui         ← chosen
- (b) MUI / Chakra / Mantine
- (c) custom CSS
- (d) I'll provide designs

Rationale: fixed by user constraint. Explicitly replaces the reference app's
MUI + Tailwind dual-system, which was flagged as a problem.

**14. Responsive priority?**
- (a) desktop-first                ← chosen
- (b) mobile-first
- (c) both equal
- (d) desktop only

Rationale: PM/Kanban tools are used at a desk; mobile gets a usable
read/comment view but isn't the primary design target for v1.

**15. Accessibility target?**
- (a) WCAG AA                      ← chosen
- (b) basic only
- (c) WCAG AAA
- (d) not yet a priority

Rationale: shadcn/ui (Radix primitives) makes AA close to free — no reason
to target lower.

## D. Integrations

**16. Payments?**
- (a) none                         ← chosen
- (b) Stripe
- (c) other (Paddle/LemonSqueezy)
- (d) crypto

Rationale: internal tool, not a paid product, at MVP stage.

**17. Email?**
- (a) none
- (b) transactional only (Resend/Postmark/SES)   ← chosen
- (c) marketing only (Mailchimp etc.)
- (d) both

Rationale: invite emails and due-date/assignment notifications need a
transactional sender; Supabase Auth's built-in email covers invite/magic-link
delivery for v1, avoiding a third-party integration until it's needed.

**18. AI/LLM features?**
- (a) none                         ← chosen
- (b) Anthropic
- (c) OpenAI
- (d) multi-provider via OpenRouter/LiteLLM

Rationale: out of scope for a PM-tool MVP; not in the reference app either.

**19. Search?**
- (a) none
- (b) DB full-text                 ← chosen
- (c) Elasticsearch/Meilisearch self-hosted
- (d) Algolia/Typesense Cloud

Rationale: Postgres full-text search (`tsvector`) directly replaces the
reference app's naive `/search` endpoint, at zero extra infra cost.

**20. Analytics?**
- (a) none                         ← chosen
- (b) privacy-friendly (PostHog/Plausible)
- (c) GA/Mixpanel
- (d) custom

Rationale: not needed for an internal MVP; can be added post-v1 without
touching the data model.

## E. Deployment & Ops

**21. Hosting?**
- (a) Vercel/Netlify                ← chosen
- (b) Railway/Render/Fly
- (c) AWS/GCP/Azure
- (d) self-hosted / on-prem

Rationale: Next.js + Vercel is the path of least friction and pairs cleanly
with Supabase; replaces the reference app's AWS EC2/Amplify/API Gateway stack
entirely.

**22. CI/CD?**
- (a) GitHub Actions                ← chosen
- (b) GitLab CI
- (c) other
- (d) none yet

**23. Environments?**
- (a) prod only
- (b) prod + preview                ← chosen
- (c) prod + staging + preview
- (d) prod + staging + dev

Rationale: Vercel preview deployments + a separate Supabase project for prod
is enough for a solo MVP; formal staging adds ops overhead not justified yet.

**24. Monitoring/errors?**
- (a) Sentry                        ← chosen
- (b) Datadog/New Relic
- (c) basic logging only
- (d) none

Rationale: free tier is enough at this scale and catches client + server
errors in a Next.js app cheaply.

**25. Backup/DR?**
- (a) provider-managed               ← chosen
- (b) manual periodic
- (c) automated cross-region
- (d) not yet

Rationale: Supabase's built-in daily backups are sufficient at MVP scale.

## F. Quality & Constraints

**26. Test coverage target?**
- (a) 90%+
- (b) 70–90%
- (c) critical paths only            ← chosen
- (d) end-to-end only

Rationale: matches the validation-contract model — assertions on core flows
(auth, CRUD, board reorder, RLS isolation) rather than exhaustive coverage.

**27. Performance budget (p95)?**
- (a) <100 ms
- (b) <500 ms                        ← chosen
- (c) <2 s
- (d) not a priority yet

**28. Internationalization?**
- (a) English only                   ← chosen
- (b) plan for i18n later
- (c) multi-lang from day one
- (d) includes RTL languages

**29. Compliance?**
- (a) none                           ← chosen
- (b) GDPR
- (c) HIPAA
- (d) SOC2 / enterprise

Rationale: internal small-team tool; soft-delete (Q10) is enough hygiene for
now without formal GDPR process.

**30. Documentation?**
- (a) code comments only
- (b) README + API docs              ← chosen
- (c) user docs + dev docs
- (d) full docs site

Rationale: a solo vibe-coder needs a README that explains how to run/extend
the app; a full docs site is overkill.
