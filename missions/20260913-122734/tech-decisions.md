# Tech decisions

_Mission: 20260913-122734 — Client-facing handover documents_

## Stack

All items below are already in the project and unchanged by this mission. This mission adds only three new runtime libraries.

- **Next.js 16.3.1** with App Router (unchanged) <!-- verified in package.json 2026-09-13 -->
- **React 19.2.8** (unchanged) <!-- verified in package.json 2026-09-13 -->
- **TypeScript 5.x** (unchanged) <!-- verified in package.json 2026-09-13 -->
- **Supabase JS 2.112.3 + @supabase/ssr 0.12.4** (unchanged) <!-- verified in package.json 2026-09-13 -->
- **Tailwind CSS 4.x + @tailwindcss/typography 0.5.x** (already installed — prose classes free) <!-- verified in package.json 2026-09-13 -->
- **Vitest 4.1.10 + @testing-library/react 16.3.2** (unchanged) <!-- verified in package.json 2026-09-13 -->
- **Supabase MCP** (already configured, used for migrations and type generation)

## Libraries used

New additions for this mission:

- **`react-markdown@^10.1.0`** — React Server Component compatible markdown renderer; replaces whitespace-pre-line plain text in portal. Selected over marked.js (no React integration) and MDX (build complexity). <!-- verified against https://www.npmjs.com/package/react-markdown 2026-09-13; latest: 10.1.0 -->
- **`remark-gfm@^4.0.1`** — GFM plugin for react-markdown; enables tables, blockquotes, strikethrough required by handover template. <!-- verified against https://www.npmjs.com/package/remark-gfm 2026-09-13; latest: 4.0.1 -->
- **`sanitize-html@^2.17.7`** — Server-side HTML sanitization (Node/edge compatible); strips script tags and event handlers before rendering. Selected because it runs in Node without DOM, unlike DOMPurify which requires a browser. <!-- verified against https://www.npmjs.com/package/sanitize-html 2026-09-13; latest: 2.17.7 -->
- **`@types/sanitize-html`** — TypeScript types for sanitize-html.

## Libraries explicitly avoided

- **DOMPurify** — browser-only; would force a `"use client"` boundary on the markdown renderer, conflicting with the RSC approach.
- **MDX / next-mdx-remote** — adds build pipeline complexity; this is runtime markdown, not static content.
- **marked.js** — no native React integration; extra wrapper needed.

## File layout

New files this mission adds (within existing structure):

```
lib/
  docs/
    youtube.ts            # YouTube URL detection + embed URL builders
    placeholders.ts       # resolvePlaceholders utility + KNOWN_PLACEHOLDER_KEYS
  queries/
    doc-templates.ts      # getDocTemplates, getDocTemplate, getDocTemplateLinks
    placeholder-values.ts # getPlaceholderValues
  actions/
    doc-templates.ts      # create/rename/delete template, add/remove link, createDocFromTemplate
    placeholder-values.ts # upsert placeholder values
  validation/
    doc-templates.ts      # Zod schemas for template actions

components/
  portal/
    markdown-content.tsx  # RSC markdown renderer with sanitize-html
    doc-link-card.tsx     # unified card/iframe component
  templates/
    doc-template-list.tsx
    create-doc-template-sheet.tsx
    doc-template-link-editor.tsx
  docs/
    new-doc-from-template-button.tsx
    template-picker.tsx
  project-settings/
    placeholder-values-form.tsx

app/
  (workspace)/w/[workspaceSlug]/
    templates/page.tsx          # add Docs tab
    projects/[projectId]/settings/page.tsx  # add Placeholder values section

supabase/migrations/
  <ts>_doc_templates.sql
  <ts>_doc_template_links.sql
  <ts>_doc_templates_rls.sql
  <ts>_doc_placeholder_values.sql
  <ts>_seed_goodguys_handover_template.sql

tests/unit/
  youtube-detection.test.ts
  markdown-renderer.test.tsx
  doc-templates-seed.test.ts
  doc-templates-delete-guard.test.ts
  placeholder-resolution.test.ts
```

## External services needed

- **Supabase** (already connected — MCP configured, project ID qcipqonnqajmazdbysow)
  - MCP: `mcp__6bfc25fd-bab6-4773-9766-e288f58d43bc__*` — use for `apply_migration`, `generate_typescript_types`, `execute_sql` verification
  - No new credentials needed — existing connection used
- **Vercel** (existing deployment) — no new env vars required for this mission

## How to run the app

```
npm run dev
```

## How to run tests

```
npm run test
```

## How to run linter

```
npm run lint
```

## How to run type-check

```
npm run type-check
```

## Conventions

All conventions from the existing codebase apply unchanged:

- **Server Components by default** in the portal; "use client" only when state or event handlers are needed
- **RSC data loading pattern**: fetch in the page Server Component, pass typed props down; Client Components own interaction only
- **Supabase client**: `createClient()` from `@/lib/supabase/server` in RSCs; `createBrowserClient()` in client components
- **Actions**: named exports from `lib/actions/*.ts`, validated with Zod, revalidate path on mutation
- **Queries**: named exports from `lib/queries/*.ts`, return typed data or throw
- **Error handling**: actions return `{ error: string }` on failure; callers show toast via sonner
- **Naming**: kebab-case files, PascalCase components, camelCase functions
- **Types**: always infer from DB types (`Database['public']['Tables']['doc_templates']['Row']`), don't hand-write interfaces
- **RLS**: every new table has RLS enabled + explicit policies; never bypass with service role in application code
- **Migrations**: timestamp prefix `YYYYMMDDHHMMSS_<slug>.sql`; each idempotent where possible
- **Placeholder syntax**: `{{key}}` in template content; resolution happens at render time, never stored back
- **Sanitization**: `sanitize-html` on team-mode content allowing `<mark data-unresolved>` passthrough; client mode strips marks too
