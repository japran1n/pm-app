// Project B — "Nordvik — Growth Retainer" (hourly). Running since 1 March:
// CRO experiments, SEO and webshop improvements on a monthly hours budget.
// Day offsets are relative to TODAY (2026-09-23).

import type { TaskSpec } from "./types";

const SHOP = "https://www.nordvikoutdoor.se";

export const PROJECT_B_TASKS: TaskSpec[] = [
  // ------------------------------------------------ Q2 — CRO sprint (done)
  {
    ref: "b-audit", title: "CRO audit & experiment backlog", status: "Completed", priority: "high", type: "delivery", phase: "Q2 — CRO sprint",
    assignees: ["anna", "maja"], start: -206, due: -195, estimate: 960, clientVisible: true, createdDaysAgo: 208, tags: ["cro"],
    description: "Heuristic review, session recordings (Hotjar) and funnel analysis. Output: 24 prioritised hypotheses (ICE score).",
  },
  {
    ref: "b-test-checkout", title: "A/B test: one-page checkout vs. 3-step", status: "Completed", priority: "urgent", type: "delivery", phase: "Q2 — CRO sprint",
    assignees: ["marko", "maja"], watchers: ["clara"], start: -190, due: -150, estimate: 1800, clientVisible: true, createdDaysAgo: 195, tags: ["cro", "ab-test"],
    description: "Winner: one-page checkout, +8.4% checkout completion (95% significance, 21 days, 38k sessions).",
    custom: { "Experiment ID": "EXP-001", "Expected uplift %": "5", "Quick win": "false" },
  },
  {
    ref: "b-test-shipping", title: "A/B test: free-shipping threshold banner", status: "Completed", priority: "high", type: "delivery", phase: "Q2 — CRO sprint",
    assignees: ["marko"], start: -170, due: -140, estimate: 600, clientVisible: true, createdDaysAgo: 180, tags: ["cro", "ab-test"],
    custom: { "Experiment ID": "EXP-002", "Expected uplift %": "3", "Quick win": "true" },
  },
  {
    ref: "b-test-sticky", title: "A/B test: sticky add-to-cart on mobile PDP", status: "Completed", priority: "high", type: "delivery", phase: "Q2 — CRO sprint",
    assignees: ["marko", "nina"], start: -150, due: -120, estimate: 720, clientVisible: true, createdDaysAgo: 160, tags: ["cro", "ab-test", "mobile"],
    custom: { "Experiment ID": "EXP-003", "Expected uplift %": "4", "Quick win": "true" },
  },
  {
    ref: "b-test-trust", title: "A/B test: trust badges in cart", status: "Canceled", priority: "low", type: "delivery", phase: "Q2 — CRO sprint",
    assignees: ["marko"], start: -130, due: -110, estimate: 300, clientVisible: true, createdDaysAgo: 140, tags: ["cro", "ab-test"],
    description: "Stopped after 14 days — inconclusive (p=0.41) and traffic needed for EXP-005.",
    custom: { "Experiment ID": "EXP-004", "Expected uplift %": "2" },
  },
  {
    ref: "b-klarna", title: "Klarna Checkout v4 upgrade", status: "Completed", priority: "high", type: "delivery", phase: "Q2 — CRO sprint",
    assignees: ["marko"], start: -125, due: -105, estimate: 900, clientVisible: true, createdDaysAgo: 130, tags: ["checkout"],
  },
  {
    ref: "b-giftcard", title: "Add digital gift card product", status: "Completed", priority: "medium", type: "client_request", phase: "Q2 — CRO sprint",
    assignees: ["john"], start: -115, due: -100, estimate: 480, clientVisible: true, createdDaysAgo: 118,
  },

  // ---------------------------------------------- Q3 — SEO foundations (done)
  {
    ref: "b-keywords", title: "Keyword research — autumn/winter season", status: "Completed", priority: "high", type: "delivery", phase: "Q3 — SEO foundations",
    assignees: ["john"], start: -100, due: -85, estimate: 720, clientVisible: true, createdDaysAgo: 102, tags: ["seo"],
  },
  {
    ref: "b-schema", title: "Product & breadcrumb structured data", status: "Completed", priority: "medium", type: "delivery", phase: "Q3 — SEO foundations",
    assignees: ["marko"], start: -90, due: -75, estimate: 600, clientVisible: true, createdDaysAgo: 95, tags: ["seo", "schema"],
  },
  {
    ref: "b-soft404", title: "Fix 312 soft-404s and redirect chains", status: "Completed", priority: "high", type: "delivery", phase: "Q3 — SEO foundations",
    assignees: ["john"], start: -80, due: -65, estimate: 540, clientVisible: true, createdDaysAgo: 85, tags: ["seo", "technical"],
  },
  {
    ref: "b-cwv", title: "Core Web Vitals: LCP on category pages 4.1s → 2.2s", status: "Completed", priority: "urgent", type: "delivery", phase: "Q3 — SEO foundations",
    assignees: ["marko"], start: -70, due: -50, estimate: 1200, clientVisible: true, createdDaysAgo: 75, tags: ["performance"],
    checklist: [["Preload hero image", true], ["Defer review widget", true], ["Font subsetting", true], ["Image CDN evaluation", true]],
  },
  {
    ref: "b-internal-links", title: "Internal linking: journal → categories", status: "Completed", priority: "medium", type: "delivery", phase: "Q3 — SEO foundations",
    assignees: ["john"], start: -60, due: -45, estimate: 480, clientVisible: true, createdDaysAgo: 62, tags: ["seo", "content"],
  },
  {
    ref: "b-ga4-double", title: "GA4 purchase events double-counted on Klarna confirmation", status: "Completed", priority: "urgent", type: "qa", phase: "Q3 — SEO foundations",
    assignees: ["marko"], author: "nina", start: -58, due: -56, estimate: 180, clientVisible: false, createdDaysAgo: 58, billable: false, tags: ["bug", "analytics"],
  },

  // -------------------------------------- Webshop improvements (active)
  {
    ref: "b-compare", title: "A/B test: product comparison on category pages", status: "In Dev", priority: "high", type: "delivery", phase: "Webshop improvements",
    assignees: ["marko", "maja"], watchers: ["clara", "anna"], start: -10, due: 4, estimate: 1200, clientVisible: true, createdDaysAgo: 20, tags: ["cro", "ab-test"],
    description: "Compare up to 3 jackets side by side. Hypothesis: fewer pogo-sticking visits between PDPs → +3% category CR.",
    custom: { "Experiment ID": "EXP-007", "Expected uplift %": "3", "GA4 report": "https://analytics.google.com/analytics/web/#/p312456789/reports/explorer", "Quick win": "false" },
    checklist: [["Variant design", true], ["Build variant", false], ["QA on devices", false], ["Launch in VWO", false]],
  },
  { ref: "b-compare-design", parent: "b-compare", title: "Comparison drawer — design", status: "Completed", priority: "high", type: "delivery", phase: "Webshop improvements", assignees: ["maja"], start: -10, due: -5, estimate: 480 },
  { ref: "b-compare-build", parent: "b-compare", title: "Comparison drawer — build", status: "In Dev", priority: "high", type: "delivery", phase: "Webshop improvements", assignees: ["marko"], start: -4, due: 2, estimate: 600 },
  { ref: "b-compare-qa", parent: "b-compare", title: "Comparison drawer — QA", status: "To Do", priority: "medium", type: "delivery", phase: "Webshop improvements", assignees: ["nina"], due: 4, estimate: 180 },
  {
    ref: "b-search", title: "Typo-tolerant site search (Algolia)", status: "In Design", priority: "high", type: "delivery", phase: "Webshop improvements",
    assignees: ["maja", "john"], start: -5, due: 12, estimate: 1500, clientVisible: true, createdDaysAgo: 15, tags: ["search"],
    custom: { "Experiment ID": "EXP-008", "Quick win": "false" },
  },
  {
    ref: "b-ctl", title: "“Complete the look” recommendations on PDP", status: "QA by Dev", priority: "medium", type: "delivery", phase: "Webshop improvements",
    assignees: ["marko"], start: -15, due: 1, estimate: 900, clientVisible: true, createdDaysAgo: 22, tags: ["merchandising"],
  },
  {
    ref: "b-reviews", title: "Trustpilot review widget on PDP", status: "Awaiting Client", priority: "medium", type: "delivery", phase: "Webshop improvements",
    assignees: ["john"], watchers: ["erik"], start: -6, due: 0, estimate: 360, clientVisible: true, pendingApproval: true, createdDaysAgo: 12,
    description: "Two placements designed — waiting for Nordvik to choose A (below buy box) or B (tab next to specs).",
  },
  {
    ref: "b-image-cdn", title: "Move product images to image CDN (AVIF/WebP)", status: "QA by Design", priority: "medium", type: "delivery", phase: "Webshop improvements",
    assignees: ["marko", "maja"], start: -9, due: 3, estimate: 600, clientVisible: false, createdDaysAgo: 14, tags: ["performance"],
  },
  {
    ref: "b-category-copy", title: "Autumn category text refresh (12 categories)", status: "In Dev", priority: "medium", type: "delivery", phase: "Webshop improvements",
    assignees: ["john"], start: -7, due: 6, estimate: 720, clientVisible: true, createdDaysAgo: 10, tags: ["seo", "content"],
    checklist: [["Jackets", true], ["Tents", true], ["Sleeping bags", true], ["Footwear", false], ["Base layers", false], ["Kids", false]],
  },
  {
    ref: "b-address", title: "Checkout address autocomplete (PostNord API)", status: "Blocked", priority: "high", type: "delivery", phase: "Webshop improvements",
    assignees: ["marko"], start: -8, due: 5, estimate: 480, clientVisible: true, createdDaysAgo: 16, tags: ["checkout"],
    blockedReason: "Waiting for Nordvik to order the PostNord address API subscription (their contract).",
  },
  {
    ref: "b-bug-klarna-ipad", title: "Klarna widget overlaps footer on iPad landscape", status: "In Dev", priority: "high", type: "qa", phase: "Webshop improvements",
    assignees: ["marko"], author: "nina", due: -2, estimate: 90, clientVisible: false, createdDaysAgo: 5, billable: false, tags: ["bug", "checkout"],
  },
  {
    ref: "b-bug-search", title: "Search returns 0 results for “ryggsäck”", status: "To Do", priority: "urgent", type: "qa", phase: "Webshop improvements",
    assignees: ["john"], author: "clara", due: 0, estimate: 60, clientVisible: true, createdDaysAgo: 1, tags: ["bug", "search"],
    description: "Reported by Clara via the portal. Probably the å/ä/ö normalisation in the current search index.",
  },
  {
    ref: "b-hero-swap", title: "Swap hero on /kampanj to the autumn campaign", status: "In Dev", priority: "high", type: "client_request", phase: "Webshop improvements",
    assignees: ["maja"], start: -1, due: 0, estimate: 120, clientVisible: true, createdDaysAgo: 3,
  },
  {
    ref: "b-stock-per-store", title: "Show stock per store on PDP", status: "Backlog", priority: "low", type: "client_request",
    assignees: [], due: null, estimate: 1200, clientVisible: true, createdDaysAgo: 6,
  },
  {
    ref: "b-wishlist", title: "Wishlist for logged-in customers", status: "To Do", priority: "low", type: "delivery", phase: "Webshop improvements",
    assignees: ["marko"], due: 20, estimate: 900, clientVisible: true, createdDaysAgo: 18,
  },
  {
    ref: "b-report-automation", title: "Automate monthly report in Looker Studio", status: "In Dev", priority: "low", type: "improvement",
    assignees: ["anna"], start: -12, due: 8, estimate: 480, clientVisible: false, createdDaysAgo: 20, billable: false, tags: ["internal"],
  },
  {
    ref: "b-paid-social", title: "Extend retainer: paid-social landing pages", status: "Backlog", priority: "backlog", type: "change_request",
    assignees: [], due: null, estimate: 2400, clientVisible: true, createdDaysAgo: 4,
  },

  // --------------------------------------- Black Friday readiness (blocked)
  {
    ref: "b-bf-landing", title: "Black Friday landing page", status: "To Do", priority: "urgent", type: "page", phase: "Black Friday readiness",
    assignees: ["maja", "marko"], start: 14, due: 35, estimate: 1440, clientVisible: true, createdDaysAgo: 9, tags: ["black-friday"],
    page: {
      slug: "/black-friday", kind: "static",
      sections: [
        { title: "Countdown hero", status: "To Do", component: "Countdown hero" },
        { title: "Deals grid", status: "To Do", kind: "cms", component: "Deal card" },
        { title: "Newsletter early access", status: "To Do" },
      ],
      meta: { intent: "Capture early-access sign-ups, then convert on the day.", audience: "Newsletter subscribers & deal hunters", primaryCta: "Get early access", tone: "Energetic but on-brand", keywords: ["black friday friluft", "rea vandringskängor"], copyStatus: "not_started" },
      estimates: { design: 12, development: 14, content_seo: 4, qa: 4, pm: 3 },
      links: [{ kind: "figma", label: "Figma — BF concepts", url: "https://www.figma.com/design/NrdVkBF26/Black-Friday-2026", clientVisible: true }],
    },
  },
  {
    ref: "b-gift-guide", title: "Christmas gift guide", status: "Backlog", priority: "medium", type: "page", phase: "Black Friday readiness",
    assignees: ["john"], due: 50, estimate: 720, clientVisible: true, createdDaysAgo: 9,
    page: {
      slug: "/gift-guide", kind: "cms",
      sections: [{ title: "Gift ideas by budget", status: "Backlog", kind: "cms", component: "Deal card" }, { title: "Gift card upsell", status: "Backlog" }],
      estimates: { design: 6, development: 6, content_seo: 6 },
    },
  },
  {
    ref: "b-bf-loadtest", title: "Load test checkout for 5× traffic", status: "Blocked", priority: "high", type: "delivery", phase: "Black Friday readiness",
    assignees: ["marko", "nina"], due: 30, estimate: 480, clientVisible: false, createdDaysAgo: 9,
    blockedReason: "Needs Centra staging environment — Nordvik IT to provision.",
  },
  {
    ref: "b-bf-assortment", title: "Confirm Black Friday assortment & discounts", status: "Awaiting Client", priority: "high", type: "delivery", phase: "Black Friday readiness",
    assignees: ["anna"], watchers: ["clara", "erik"], due: 7, estimate: 60, clientVisible: true, pendingApproval: true, createdDaysAgo: 9,
  },

  // --------------------------------------------------------------- Recurring
  {
    ref: "b-monthly-report", title: "Monthly performance report — September", status: "To Do", priority: "medium", type: "delivery",
    assignees: ["anna"], start: 5, due: 7, estimate: 240, clientVisible: true, createdDaysAgo: 30,
    recurrence: { freq: "monthly", interval: 1 },
    description: "Sessions, conversion rate, revenue, top experiments and next month's plan. Shared as a PDF + walkthrough call.",
  },
  {
    ref: "b-report-aug", title: "Monthly performance report — August", status: "Completed", priority: "medium", type: "delivery",
    assignees: ["anna"], start: -18, due: -16, estimate: 240, clientVisible: true, createdDaysAgo: 50,
  },
  {
    ref: "b-report-jul", title: "Monthly performance report — July", status: "Completed", priority: "medium", type: "delivery",
    assignees: ["anna"], start: -49, due: -47, estimate: 240, clientVisible: true, createdDaysAgo: 80,
  },
  {
    ref: "b-cro-sync", title: "Weekly CRO sync with Nordvik e-com", status: "To Do", priority: "low", type: "delivery",
    assignees: ["anna", "marko"], start: 1, due: 1, estimate: 45, clientVisible: false, createdDaysAgo: 200,
    recurrence: { freq: "weekly", interval: 1 },
  },
  {
    ref: "b-newsletter-tpl", title: "Monthly newsletter template update", status: "Completed", priority: "low", type: "client_request",
    assignees: ["maja"], start: -10, due: -8, estimate: 120, clientVisible: true, createdDaysAgo: 12,
    recurrence: { freq: "monthly", interval: 1 },
  },
];

export const PROJECT_B_COMPONENTS = ["Countdown hero", "Deal card", "Product grid"];

export const PROJECT_B_SHOP_URL = SHOP;
