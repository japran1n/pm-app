// Docs content (Markdown — the docs editor stores plain Markdown).

import type { PersonKey } from "./accounts";

export type DocSpec = {
  title: string;
  by: PersonKey;
  updatedBy?: PersonKey;
  daysAgo: number;
  updatedDaysAgo?: number;
  kind?: "note" | "training" | "process" | "handover" | "onboarding" | "feedback" | "portal_guide" | "brief";
  clientVisible?: boolean;
  relevantFrom?: "kickoff" | "ongoing" | "launch";
  content: string;
  links?: Array<{ url: string; title: string; description?: string }>;
};

export type DocFolderSpec = { name: string | null; by?: PersonKey; docs: DocSpec[]; children?: DocFolderSpec[] };

export const WORKSPACE_DOCS: DocFolderSpec[] = [
  {
    name: "Agency handbook",
    docs: [
      {
        title: "How we run projects", by: "tom", updatedBy: "anna", daysAgo: 300, updatedDaysAgo: 12, kind: "process",
        content: `
# How we run projects

## The short version
1. **Discovery** — workshops, audits, a signed-off sitemap.
2. **Design** — art direction, design system, templates. Two feedback rounds per template.
3. **Development** — Webflow build, integrations, CMS.
4. **Content & QA** — real content in, device testing, accessibility.
5. **Launch** — redirects, go-live, training, 30 days warranty.

## Rituals
- Monday: sprint planning (30 min)
- Wednesday: design critique
- Friday: status update to every client before 15:00

## Tools
- Board & portal: this app
- Design: Figma
- Build: Webflow
- Time: log it the same day, with a category
`,
        links: [{ url: "https://www.loom.com/share/goodguys-process-walkthrough", title: "Process walkthrough (Loom, 12 min)" }],
      },
      {
        title: "Definition of done", by: "anna", daysAgo: 250, updatedDaysAgo: 40, kind: "process",
        content: `
# Definition of done

A task is **Completed** when:

- [x] It works on Chrome, Safari (macOS + iOS), Firefox and Android Chrome
- [x] Design QA passed (Maja or the design lead)
- [x] No console errors, Lighthouse performance ≥ 85 on mobile
- [x] Alt texts and headings checked
- [x] The client can see it on staging
- [x] Time is logged
`,
      },
      {
        title: "Webflow build conventions (Client-First)", by: "john", daysAgo: 200, updatedDaysAgo: 18, kind: "training",
        content: `
# Webflow build conventions

We follow **Finsweet Client-First**.

## Naming
- Custom classes: \`section_hero\`, \`hero_content\`, \`hero_image\`
- Utility classes: \`padding-global\`, \`container-large\`, \`text-size-large\`
- Combo classes start with \`is-\`: \`button is-secondary\`

## CMS
- Collection names are plural (\`Products\`, \`Stores\`)
- Every collection has an \`SEO title\` and \`SEO description\` field

\`\`\`css
/* never style tags globally except in the style guide */
.text-rich-text h2 { margin-top: 2rem; }
\`\`\`
`,
        links: [{ url: "https://finsweet.com/client-first/docs", title: "Client-First documentation" }],
      },
    ],
  },
  {
    name: "Onboarding",
    docs: [
      {
        title: "First week at Good Guys", by: "anna", daysAgo: 180, updatedDaysAgo: 30, kind: "onboarding",
        content: `
# First week at Good Guys

Welcome! 👋

## Day 1
- Laptop, accounts (Google, Figma, Webflow, this app)
- Lunch with the team

## Day 2–3
- Shadow a client call
- Read *How we run projects* and *Definition of done*

## Day 4–5
- Pick a small task from the Growth Retainer board
`,
      },
    ],
  },
  {
    name: null,
    docs: [
      {
        title: "Holiday calendar 2026", by: "anna", daysAgo: 260, updatedDaysAgo: 5, kind: "note",
        content: `
# Holiday calendar 2026

| Who | When |
| --- | --- |
| Maja | 13 Jul – 2 Aug |
| John | 20 Jul – 9 Aug |
| Marko | 27 Jul – 14 Aug |
| Nina | 28 Sep – 2 Oct |
| Anna | 26 Oct – 30 Oct |

Book time off in the calendar so the planner shows it.
`,
      },
    ],
  },
];

export const PROJECT_DOCS: Record<string, DocFolderSpec[]> = {
  NVWEB: [
    {
      name: "Discovery",
      docs: [
        {
          title: "Kickoff workshop notes", by: "tom", daysAgo: 99, updatedDaysAgo: 97, kind: "note",
          content: `
# Kickoff workshop — 15 June, Nordvik HQ

**Attendees:** Clara, Erik, Nordvik e-com team · Tom, Anna, Maja

## Goals
- +25% online revenue in 12 months
- Fewer returns through better product information
- Tell the repair story

## Decisions
- Webflow for content, Centra stays for commerce
- Swedish only at launch

## Action items
- [x] Erik: Centra API access
- [x] Clara: brand guidelines
- [x] Tom: sitemap v1 by 22 June
`,
          links: [{ url: "https://photos.google.com/share/nordvik-kickoff-wall", title: "Photos of the workshop wall" }],
        },
        {
          title: "Stakeholder interview summary", by: "anna", daysAgo: 92, kind: "note",
          content: `
# Stakeholder interviews

## Customer service
> "Half our tickets are about sizes and returns."

## E-commerce
- Filters are the #1 complaint
- Mobile converts at half the desktop rate

## Brand
- The repair service is invisible on today's site
`,
        },
      ],
      children: [
        {
          name: "Audits",
          docs: [
            {
              title: "SEO baseline — what we must not lose", by: "john", daysAgo: 90, kind: "note",
              content: `
# SEO baseline

- 61 400 organic clicks / month (GSC, May)
- Top landing pages: /talt, /sovsackar, /vandringskangor-dam
- 1 180 referring domains — all top-400 URLs get explicit redirects
`,
            },
          ],
        },
      ],
    },
    {
      name: "Design",
      docs: [
        {
          title: "Design principles", by: "maja", daysAgo: 75, updatedDaysAgo: 60, kind: "note", clientVisible: true,
          content: `
# Design principles

1. **Product first** — every page shows gear within one scroll.
2. **Honest numbers** — weight, warmth and waterproofing are always visible.
3. **Calm** — generous whitespace, one accent colour per page.
4. **Made to last** — repair and care are part of every product story.
`,
          links: [{ url: "https://www.figma.com/design/NrdVk2026/Nordvik-Relaunch", title: "Figma — Nordvik Relaunch" }],
        },
      ],
    },
    {
      name: null,
      docs: [
        {
          title: "Project brief", by: "tom", daysAgo: 93, updatedDaysAgo: 90, kind: "brief", clientVisible: true,
          content: `
# Project brief — Nordvik Website Relaunch

Summary of the questionnaire Clara and Erik filled in before kickoff.

## Goals
Grow online revenue 25%, reduce returns, tell the repair story.

## Must-haves
Journal, store locator, repair service page.

## Deadline
Live before Black Friday — target 30 October.
`,
        },
        {
          title: "Welcome to your project portal", by: "tom", daysAgo: 104, kind: "portal_guide", clientVisible: true, relevantFrom: "kickoff",
          content: `
# Welcome, Nordvik! 👋

This portal is where you follow the relaunch.

- **For you** — decisions and materials we need from you
- **Pages** — every page and its status
- **Scope & decisions** — what's included, change requests and quotes
- **Messages** — talk to the whole team

Questions? Message Tom directly in the portal.
`,
        },
        {
          title: "How to give design feedback", by: "maja", daysAgo: 70, kind: "feedback", clientVisible: true, relevantFrom: "ongoing",
          content: `
# How to give design feedback

- Comment **in Figma** on the exact spot
- Tell us the *problem*, not the solution ("the price is hard to find" beats "make it red")
- One person collects feedback from your side (Clara)
- Two rounds per template are included
`,
          links: [{ url: "https://help.figma.com/hc/en-us/articles/360039825314", title: "How to comment in Figma" }],
        },
        {
          title: "Editing your site in Webflow", by: "john", daysAgo: 10, kind: "training", clientVisible: true, relevantFrom: "launch",
          content: `
# Editing your site in Webflow

## Adding a journal article
1. Open the **Editor** (yoursite.com/?edit)
2. Collections → Journal → **New item**
3. Fill in title, hero image (min 2000 px wide) and the body
4. Add products to *Shop the story*
5. **Publish**

## What syncs from Centra
Products, prices and stock are synced automatically — don't edit them in Webflow.
`,
          links: [{ url: "https://university.webflow.com/courses/webflow-editor", title: "Webflow University — Editor course" }],
        },
        {
          title: "Launch handover checklist", by: "tom", daysAgo: 6, kind: "handover", clientVisible: true, relevantFrom: "launch",
          content: `
# Launch handover

- [ ] Webflow site transferred to Nordvik's workspace
- [ ] Cookiebot account transferred
- [ ] GA4 + Search Console verified on the new domain
- [ ] Editor training recorded and shared
- [ ] Warranty period: 30 days from launch
`,
        },
      ],
    },
  ],
  NVGRO: [
    {
      name: "Experiments",
      docs: [
        {
          title: "Experiment log", by: "marko", updatedBy: "anna", daysAgo: 190, updatedDaysAgo: 3, kind: "process",
          content: `
# Experiment log

| ID | Hypothesis | Result |
| --- | --- | --- |
| EXP-001 | One-page checkout | **+8.4%** completion ✅ |
| EXP-002 | Free-shipping banner | +2.1% AOV ✅ |
| EXP-003 | Sticky add-to-cart (mobile) | +3.6% add-to-cart ✅ |
| EXP-004 | Trust badges in cart | Inconclusive ⏹ |
| EXP-007 | Product comparison | Running from 2 Oct |
`,
        },
        {
          title: "Testing guidelines", by: "anna", daysAgo: 200, kind: "process",
          content: `
# Testing guidelines

- Minimum 14 days and two full weekends per test
- One test per page type at a time
- Decide the primary metric **before** launch
- 95% significance or we call it inconclusive
`,
        },
      ],
    },
    {
      name: "Reports",
      docs: [
        {
          title: "Monthly report — August 2026", by: "anna", daysAgo: 16, kind: "note", clientVisible: true,
          content: `
# Monthly report — August 2026

## Highlights
- Conversion rate **1.93%** (+0.14 pp vs July)
- Organic clicks **61 400** (+5.7%)
- LCP on category pages **2.2 s** (was 4.1 s in March)

## Hours
96 h of 100 h used. July's unused 39 h rolled over and expire 30 September.

## Next month
Product comparison test, Algolia search, Black Friday planning.
`,
        },
        {
          title: "Monthly report — July 2026", by: "anna", daysAgo: 47, kind: "note", clientVisible: true,
          content: `
# Monthly report — July 2026

Quiet holiday month: 61 h used. Core Web Vitals work continued; CrUX shows LCP down to 2.4 s.
`,
        },
      ],
    },
    {
      name: null,
      docs: [
        {
          title: "Retainer ways of working", by: "anna", daysAgo: 205, kind: "onboarding", clientVisible: true, relevantFrom: "kickoff",
          content: `
# Retainer ways of working

- **100 hours / month**, unused hours roll over one month
- Weekly CRO sync on Tuesdays 10:00
- Monthly report in the first week of the month
- Send requests through the portal — we triage within 1 working day
- Bugs marked *blocker* are handled same day
`,
        },
        {
          title: "Reading your hours page", by: "anna", daysAgo: 120, kind: "portal_guide", clientVisible: true,
          content: `
# Reading your hours page

The Hours page shows billable time per week and per category (design, development, content & SEO, project management, QA) for the current budget month.

Non-billable time — internal QA, our own tooling — is never shown or invoiced.
`,
        },
        {
          title: "SEO keyword map — autumn/winter", by: "john", daysAgo: 88, kind: "note",
          content: `
# Keyword map — autumn/winter

| Page | Primary keyword | Volume |
| --- | --- | --- |
| /collections/jackor | vinterjacka dam | 12 100 |
| /collections/sovsackar | sovsäck vinter | 4 400 |
| /collections/kangor | vandringskängor herr | 6 600 |
`,
        },
      ],
    },
  ],
};
