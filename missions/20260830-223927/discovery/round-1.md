# Discovery Round 1

_Captured: 2026-08-30T22:45:00Z_
_Adaptations from defaults: none — standard web-app set; answers derived from codebase inspection, not user input._

## A. Users & Access

**1. Who are the primary users?**
- (a) Internal team only                        ← chosen
- (b) External customers (B2C or B2B)
- (c) Public / anonymous OK
- (d) Mixed — some signed-in, some public

**2. Expected user count at v1?**
- (a) <10
- (b) 10–1,000                                  ← chosen
- (c) 1,000–100,000
- (d) >100,000

**3. Auth method?**
- (a) Email + password                          ← chosen
- (b) Magic link / passwordless
- (c) OAuth (Google/GitHub/etc)
- (d) SSO / SAML (enterprise)

**4. Role model?**
- (a) Single role
- (b) 2–3 roles (user/admin)
- (c) Granular RBAC                             ← chosen
- (d) Per-resource permissions

**5. Signup model?**
- (a) Open self-signup
- (b) Invite-only                               ← chosen
- (c) Admin-provisioned
- (d) Waitlist

## B. Data

**6. Primary data store?**
- (a) Postgres (Supabase)                       ← chosen
- (b) MySQL
- (c) SQLite
- (d) NoSQL (Mongo/DynamoDB)

**7. Data volume at v1?**
- (a) <1 GB                                     ← chosen
- (b) 1–100 GB
- (c) 100 GB–1 TB
- (d) >1 TB

**8. Real-time needs?**
- (a) None
- (b) Polling is fine
- (c) WebSockets/SSE for some features
- (d) Real-time is core                         ← chosen

**9. File/media storage?**
- (a) None
- (b) Small files (<10 MB)                      ← chosen
- (c) Large files / video
- (d) Third-party (S3 / Cloudinary)

**10. Data retention / deletion?**
- (a) Keep forever
- (b) Soft delete only                          ← chosen
- (c) Hard delete after period
- (d) Per-user export + delete (GDPR-style)

## C. Interface

**11. Primary interface?**
- (a) Web app                                   ← chosen
- (b) Native mobile
- (c) CLI
- (d) API only

**12. Rendering strategy?**
- (a) SSR (Next.js)                             ← chosen
- (b) SPA (React/Vue)
- (c) Static + progressive
- (d) Classic server-rendered

**13. Design system?**
- (a) Tailwind + shadcn/ui                      ← chosen
- (b) MUI / Chakra / Mantine
- (c) Custom CSS
- (d) I'll provide designs

**14. Responsive priority?**
- (a) Desktop-first                             ← chosen
- (b) Mobile-first
- (c) Both equal
- (d) Desktop only

**15. Accessibility target?**
- (a) WCAG AA
- (b) Basic only                                ← chosen
- (c) WCAG AAA
- (d) Not yet a priority

## D. Integrations

**16. Payments?**
- (a) None                                      ← chosen
- (b) Stripe
- (c) Other (Paddle/LemonSqueezy)
- (d) Crypto

**17. Email?**
- (a) None
- (b) Transactional only (Resend)               ← chosen
- (c) Marketing only (Mailchimp etc.)
- (d) Both

**18. AI/LLM features?**
- (a) None                                      ← chosen
- (b) Anthropic
- (c) OpenAI
- (d) Multi-provider via OpenRouter/LiteLLM

**19. Search?**
- (a) None
- (b) DB full-text (Supabase/pg_trgm)           ← chosen
- (c) Elasticsearch/Meilisearch self-hosted
- (d) Algolia/Typesense Cloud

**20. Analytics?**
- (a) None                                      ← chosen
- (b) Privacy-friendly (PostHog/Plausible)
- (c) GA/Mixpanel
- (d) Custom

## E. Deployment & Ops

**21. Hosting?**
- (a) Vercel/Netlify                            ← chosen
- (b) Railway/Render/Fly
- (c) AWS/GCP/Azure
- (d) Self-hosted / on-prem

**22. CI/CD?**
- (a) GitHub Actions                            ← chosen
- (b) GitLab CI
- (c) Other
- (d) None yet

**23. Environments?**
- (a) Prod only
- (b) Prod + preview                            ← chosen
- (c) Prod + staging + preview
- (d) Prod + staging + dev

**24. Monitoring/errors?**
- (a) Sentry                                    ← chosen
- (b) Datadog/New Relic
- (c) Basic logging only
- (d) None

**25. Backup/DR?**
- (a) Provider-managed (Supabase)               ← chosen
- (b) Manual periodic
- (c) Automated cross-region
- (d) Not yet

## F. Quality & Constraints

**26. Test coverage target?**
- (a) 90%+
- (b) 70–90%
- (c) Critical paths only                       ← chosen
- (d) End-to-end only

**27. Performance budget (p95)?**
- (a) <100 ms
- (b) <500 ms                                   ← chosen
- (c) <2 s
- (d) Not a priority yet

**28. Internationalization?**
- (a) English only                              ← chosen
- (b) Plan for i18n later
- (c) Multi-lang from day one
- (d) Includes RTL languages

**29. Compliance?**
- (a) None                                      ← chosen
- (b) GDPR
- (c) HIPAA
- (d) SOC2 / enterprise

**30. Documentation?**
- (a) Code comments only                        ← chosen
- (b) README + API docs
- (c) User docs + dev docs
- (d) Full docs site
