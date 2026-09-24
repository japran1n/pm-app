// Project A — "Nordvik — Website Relaunch" (fixed price). ~60% through:
// Discovery + Design done, Development in flight, Content & QA and Launch
// ahead. Day offsets are relative to TODAY (2026-09-23, a Wednesday).

import type { TaskSpec } from "./types";

const STAGING = "https://nordvik-outdoor.webflow.io";
const FIGMA = "https://www.figma.com/design/NrdVk2026/Nordvik-Relaunch";

export const PROJECT_A_TASKS: TaskSpec[] = [
  // ---------------------------------------------------------------- Discovery
  {
    ref: "kickoff", title: "Kickoff workshop at Nordvik HQ, Stockholm", status: "Completed", priority: "high", type: "delivery",
    phase: "Discovery", assignees: ["tom", "anna"], start: -100, due: -99, estimate: 480, clientVisible: true, createdDaysAgo: 105,
    tags: ["workshop"],
    description: "Full-day workshop with Clara, Erik and the Nordvik e-com team. Goals, audiences, success metrics and a first pass of the sitemap.",
    checklist: [["Send agenda to Clara", true], ["Book room + fika", true], ["Share workshop summary", true]],
  },
  {
    ref: "interviews", title: "Stakeholder interviews (e-com, brand, customer service)", status: "Completed", priority: "medium", type: "delivery",
    phase: "Discovery", assignees: ["anna"], start: -98, due: -93, estimate: 360, clientVisible: false, createdDaysAgo: 104,
    description: "Five 45-minute interviews. Notes live in Docs → Discovery.",
  },
  {
    ref: "seo-audit", title: "Analytics & SEO baseline audit of current site", status: "Completed", priority: "high", type: "delivery",
    phase: "Discovery", assignees: ["john"], start: -97, due: -90, estimate: 600, clientVisible: false, createdDaysAgo: 104,
    tags: ["seo", "analytics"],
    description: "Crawl of nordvikoutdoor.se, GA4 funnel review, top-100 landing pages and backlinks to protect in the redirect map.",
  },
  {
    ref: "content-inventory", title: "Content inventory of the current site", status: "Completed", priority: "medium", type: "delivery",
    phase: "Discovery", assignees: ["gary"], start: -95, due: -88, estimate: 420, clientVisible: false, createdDaysAgo: 100,
    tags: ["content"],
  },
  {
    ref: "ia-signoff", title: "Sitemap & information architecture sign-off", status: "Approved", priority: "high", type: "delivery",
    phase: "Discovery", assignees: ["tom", "maja"], start: -90, due: -84, estimate: 300, clientVisible: true, createdDaysAgo: 98,
    tags: ["ux"],
    description: "Final sitemap agreed with Clara on 1 July. Changes after this point go through a change request.",
  },

  // ------------------------------------------------------------------- Design
  {
    ref: "moodboard", title: "Moodboard & art direction", status: "Completed", priority: "high", type: "delivery",
    phase: "Design", assignees: ["maja"], start: -80, due: -74, estimate: 720, clientVisible: true, createdDaysAgo: 90,
    tags: ["design"],
  },
  {
    ref: "design-system", title: "Design system in Figma (type, colour, grid, components)", status: "Completed", priority: "high", type: "delivery",
    phase: "Design", assignees: ["maja"], watchers: ["john", "marko"], start: -74, due: -60, estimate: 1440, clientVisible: false, createdDaysAgo: 85,
    tags: ["design", "design-system"],
    checklist: [["Type scale", true], ["Colour tokens", true], ["Buttons & forms", true], ["Cards", true], ["Icon set", true]],
  },
  {
    ref: "home-design", title: "Homepage design — desktop & mobile", status: "Approved", priority: "urgent", type: "delivery",
    phase: "Design", assignees: ["maja"], start: -66, due: -52, estimate: 960, clientVisible: true, createdDaysAgo: 80,
    tags: ["design"],
    description: "Two rounds of feedback. Round 2 approved by Clara on 4 August.",
  },
  {
    ref: "template-designs", title: "Template designs: collection, product, journal", status: "Completed", priority: "high", type: "delivery",
    phase: "Design", assignees: ["maja"], start: -58, due: -40, estimate: 1680, clientVisible: true, createdDaysAgo: 70,
    tags: ["design"],
  },
  {
    ref: "mobile-nav", title: "Mobile navigation & mega-menu design", status: "Completed", priority: "medium", type: "delivery",
    phase: "Design", assignees: ["maja", "john"], start: -45, due: -38, estimate: 480, clientVisible: false, createdDaysAgo: 60,
    tags: ["design", "ux"],
  },

  // -------------------------------------------------------------- Development
  {
    ref: "webflow-setup", title: "Webflow project setup & style guide page", status: "Completed", priority: "high", type: "delivery",
    phase: "Development", assignees: ["john"], start: -30, due: -26, estimate: 480, clientVisible: false, createdDaysAgo: 40,
    tags: ["webflow"],
  },
  {
    ref: "global-components", title: "Build global components (navbar, footer, cards)", status: "Completed", priority: "high", type: "delivery",
    phase: "Development", assignees: ["john", "marko"], start: -26, due: -18, estimate: 1200, clientVisible: false, createdDaysAgo: 35,
    tags: ["webflow", "components"],
    checklist: [["Navbar + mega-menu", true], ["Footer", true], ["Product card", true], ["Article card", true], ["Newsletter block", true]],
  },
  {
    ref: "cms-setup", title: "CMS collections: products, categories, journal, stores", status: "QA by Dev", priority: "high", type: "delivery",
    phase: "Development", assignees: ["marko"], watchers: ["john"], start: -20, due: -3, estimate: 900, clientVisible: false, createdDaysAgo: 30,
    tags: ["cms"],
    checklist: [["Products collection", true], ["Categories collection", true], ["Journal collection", true], ["Stores collection", false], ["Reference fields QA", false]],
  },
  {
    ref: "centra-feed", title: "Product feed integration with Centra", status: "In Dev", priority: "urgent", type: "delivery",
    phase: "Development", assignees: ["marko"], watchers: ["tom", "anna"], start: -14, due: -2, estimate: 1500, clientVisible: false, createdDaysAgo: 25,
    tags: ["integration", "centra"],
    description: "Nightly sync of ~1,400 SKUs from Centra into the Webflow CMS via the Webflow Data API. Overdue: Centra API rate limits were lower than documented.",
    checklist: [["Auth against Centra API", true], ["Field mapping", true], ["Image sync", false], ["Nightly job + alerting", false]],
  },
  { ref: "centra-map", parent: "centra-feed", title: "Map Centra fields to CMS fields", status: "Completed", priority: "high", type: "delivery", phase: "Development", assignees: ["marko"], start: -14, due: -9, estimate: 360 },
  { ref: "centra-sync", parent: "centra-feed", title: "Nightly sync job with retry & Slack alert", status: "In Dev", priority: "high", type: "delivery", phase: "Development", assignees: ["marko"], start: -6, due: 1, estimate: 480 },
  { ref: "centra-images", parent: "centra-feed", title: "Image sync + alt text fallback", status: "To Do", priority: "medium", type: "delivery", phase: "Development", assignees: ["marko"], due: 3, estimate: 300 },
  {
    ref: "klaviyo", title: "Newsletter sign-up → Klaviyo integration", status: "In Dev", priority: "medium", type: "delivery",
    phase: "Development", assignees: ["john"], start: -3, due: 2, estimate: 360, clientVisible: false, createdDaysAgo: 20,
    tags: ["integration"],
  },
  {
    ref: "redirects", title: "301 redirect map (top 400 URLs)", status: "In Dev", priority: "high", type: "delivery",
    phase: "Development", assignees: ["john"], watchers: ["tom"], start: -5, due: 0, estimate: 480, clientVisible: false, createdDaysAgo: 18,
    tags: ["seo"],
    description: "Built from the discovery crawl. Anything with backlinks or >50 sessions/month gets an explicit redirect.",
  },
  {
    ref: "cookie", title: "Cookie consent (Cookiebot) + Consent Mode v2", status: "To Do", priority: "medium", type: "delivery",
    phase: "Development", assignees: ["marko"], due: 6, estimate: 240, clientVisible: false, createdDaysAgo: 15,
  },
  {
    ref: "perf-budget", title: "Performance budget & Lighthouse CI", status: "To Do", priority: "low", type: "delivery",
    phase: "Development", assignees: ["marko"], due: 9, estimate: 300, clientVisible: false, createdDaysAgo: 15,
    tags: ["performance"],
  },
  {
    ref: "store-data", title: "Import store locator data (42 stores)", status: "Blocked", priority: "high", type: "delivery",
    phase: "Development", assignees: ["john"], start: -4, due: 1, estimate: 240, clientVisible: true, createdDaysAgo: 12,
    blockedReason: "Waiting for the store list CSV (addresses + opening hours) from Nordvik — requested 15 Sep.",
  },

  // -------------------------------------------------------- Content & QA
  {
    ref: "category-copy", title: "Category page copy (8 categories)", status: "Awaiting Client", priority: "high", type: "delivery",
    phase: "Content & QA", assignees: ["gary"], watchers: ["tom"], start: -8, due: 1, estimate: 720, clientVisible: true, pendingApproval: true,
    createdDaysAgo: 14, tags: ["copy"],
    description: "Drafts for Tents, Sleeping bags, Backpacks, Jackets, Footwear, Kitchen, Kids and Accessories. Waiting for Clara's review.",
  },
  {
    ref: "photo-selection", title: "Select hero photography from Nordvik photo bank", status: "To Do", priority: "medium", type: "delivery",
    phase: "Content & QA", assignees: ["maja"], due: 8, estimate: 240, clientVisible: true, createdDaysAgo: 10,
  },
  {
    ref: "browser-qa", title: "Cross-browser & device QA pass", status: "To Do", priority: "high", type: "delivery",
    phase: "Content & QA", assignees: ["nina"], start: 12, due: 19, estimate: 960, clientVisible: false, createdDaysAgo: 8,
    tags: ["qa"],
    checklist: [["Chrome / Edge", false], ["Safari macOS + iOS", false], ["Firefox", false], ["Android Chrome", false]],
  },
  {
    ref: "a11y", title: "Accessibility audit (WCAG 2.2 AA)", status: "Backlog", priority: "high", type: "delivery",
    phase: "Content & QA", assignees: ["nina"], start: 14, due: 21, estimate: 600, clientVisible: false, createdDaysAgo: 8,
    tags: ["qa", "a11y"],
  },
  {
    ref: "bug-menu", title: "Mobile menu doesn't close after tapping an anchor link", status: "In Dev", priority: "urgent", type: "qa",
    phase: "Content & QA", assignees: ["john"], author: "nina", due: -1, estimate: 60, clientVisible: false, createdDaysAgo: 4, billable: false,
    tags: ["bug", "mobile"],
    description: "Steps: iPhone 15 / Safari → open menu → tap 'Stores'. Page scrolls but the menu overlay stays open.",
  },
  {
    ref: "bug-video", title: "Hero video stutters on Safari 18", status: "QA by Dev", priority: "high", type: "qa",
    phase: "Content & QA", assignees: ["marko"], author: "nina", due: 1, estimate: 90, clientVisible: false, createdDaysAgo: 6, billable: false,
    tags: ["bug", "safari"],
  },
  {
    ref: "bug-filters", title: "Journal filters reset on browser back", status: "To Do", priority: "medium", type: "qa",
    phase: "Content & QA", assignees: ["marko"], author: "nina", due: 5, estimate: 120, clientVisible: false, createdDaysAgo: 3, billable: false,
    tags: ["bug"],
  },
  {
    ref: "bug-footer", title: "Typo in footer: “Kundtjänst” link points to /contact", status: "Completed", priority: "low", type: "qa",
    phase: "Content & QA", assignees: ["john"], author: "nina", due: -6, estimate: 15, clientVisible: false, createdDaysAgo: 9, billable: false,
    tags: ["bug"],
  },
  {
    ref: "bug-contrast", title: "Low contrast on sale badge (3.1:1)", status: "QA by Design", priority: "medium", type: "qa",
    phase: "Content & QA", assignees: ["maja"], author: "nina", due: 2, estimate: 30, clientVisible: false, createdDaysAgo: 2, billable: false,
    tags: ["bug", "a11y"],
  },

  // ------------------------------------------------------------------ Launch
  {
    ref: "launch-checklist", title: "Launch checklist", status: "To Do", priority: "urgent", type: "delivery",
    phase: "Launch", assignees: ["tom"], start: 30, due: 37, estimate: 240, clientVisible: true, createdDaysAgo: 20,
    tags: ["launch"],
    checklist: [["Freeze content", false], ["Final redirect test", false], ["Search Console verified", false], ["Go/no-go call with Nordvik", false]],
  },
  { ref: "launch-dns", parent: "launch-checklist", title: "DNS cutover plan with Nordvik IT", status: "Backlog", priority: "high", type: "delivery", phase: "Launch", assignees: ["marko"], due: 33, estimate: 120 },
  { ref: "launch-gsc", parent: "launch-checklist", title: "Submit new sitemap to Search Console", status: "Backlog", priority: "medium", type: "delivery", phase: "Launch", assignees: ["john"], due: 37, estimate: 30 },
  { ref: "launch-ga4", parent: "launch-checklist", title: "Verify GA4 e-commerce events on production", status: "Backlog", priority: "medium", type: "delivery", phase: "Launch", assignees: ["john"], due: 37, estimate: 90 },
  {
    ref: "training", title: "Webflow editor training for Nordvik's team", status: "To Do", priority: "medium", type: "delivery",
    phase: "Launch", assignees: ["john", "tom"], start: 28, due: 28, estimate: 180, clientVisible: true, createdDaysAgo: 20,
  },
  {
    ref: "monitoring", title: "Post-launch monitoring (uptime, 404s, Core Web Vitals)", status: "Backlog", priority: "low", type: "delivery",
    phase: "Launch", assignees: ["marko"], due: null, estimate: 180, clientVisible: false, createdDaysAgo: 20,
  },

  // --------------------------------------------- Client & change requests
  {
    ref: "cr-size-guide", title: "Change request: size guide on product pages", status: "In Design", priority: "high", type: "change_request",
    phase: "Development", assignees: ["maja"], watchers: ["clara"], start: -2, due: 6, estimate: 720, clientVisible: true, createdDaysAgo: 9,
    description: "Approved CR — 12 h quoted. Interactive size guide per category (jackets, footwear, kids).",
  },
  {
    ref: "cr-language", title: "Change request: English language version", status: "Backlog", priority: "low", type: "change_request",
    assignees: [], start: null, due: null, estimate: 2400, clientVisible: true, createdDaysAgo: 5,
    description: "Quoted, waiting for Nordvik's decision. Would use Webflow Localization.",
  },
  {
    ref: "req-team-photos", title: "Update team photos on About page", status: "Completed", priority: "low", type: "client_request",
    phase: "Development", assignees: ["john"], due: -8, estimate: 45, clientVisible: true, createdDaysAgo: 14,
  },
  {
    ref: "req-instagram", title: "Instagram feed on the homepage", status: "Canceled", priority: "backlog", type: "client_request",
    assignees: [], due: null, estimate: 240, clientVisible: true, createdDaysAgo: 30,
    description: "Dropped after discussing performance impact — replaced by a curated UGC block.",
  },
  {
    ref: "improve-cms-naming", title: "Refactor CMS class naming to Client-First", status: "To Do", priority: "low", type: "improvement",
    assignees: ["john"], due: 14, estimate: 180, clientVisible: false, createdDaysAgo: 7, billable: false,
    tags: ["internal"],
  },
  {
    ref: "status-update", title: "Weekly status update to Nordvik", status: "To Do", priority: "medium", type: "delivery",
    assignees: ["tom"], start: 2, due: 2, estimate: 30, clientVisible: false, createdDaysAgo: 60,
    recurrence: { freq: "weekly", interval: 1 },
    description: "Every Friday: progress, next week's plan, open questions for Clara.",
  },

  // ------------------------------------------------------ Architecture pages
  {
    ref: "page-home", title: "Home", status: "QA by Design", priority: "urgent", type: "page", phase: "Development",
    assignees: ["john"], watchers: ["maja", "clara"], start: -12, due: 3, estimate: 960, clientVisible: true, createdDaysAgo: 40,
    custom: { "Figma frame": `${FIGMA}?node-id=12-4`, "Webflow page ID": "65f1a2b3c4d5e6f7a8b9c0d1", "Word count": "420", "Needs translation": "true" },
    page: {
      slug: "/", kind: "static",
      sections: [
        { title: "Hero with seasonal campaign video", status: "QA by Design", component: "Hero" },
        { title: "Shop by activity", status: "Completed", component: "Category tiles" },
        { title: "Bestsellers", status: "QA by Dev", kind: "cms", component: "Product grid" },
        { title: "Built to last — sustainability teaser", status: "Completed", component: "CTA banner" },
        { title: "From the Journal", status: "In Dev", kind: "cms", component: "Article card" },
        { title: "Newsletter sign-up", status: "In Dev", component: "Newsletter block" },
      ],
      meta: { intent: "Inspire and route visitors into the right category within one scroll.", audience: "Returning customers and hikers planning a trip", primaryCta: "Shop the autumn collection", tone: "Confident, outdoorsy, warm", keywords: ["friluftsutrustning", "outdoor gear sweden", "tält"], copyStatus: "approved" },
      estimates: { design: 24, development: 16, content_seo: 6, qa: 4 },
      links: [
        { kind: "staging", label: "Staging — Home", url: `${STAGING}/`, clientVisible: true },
        { kind: "figma", label: "Figma — Home", url: `${FIGMA}?node-id=12-4`, clientVisible: false },
      ],
    },
  },
  {
    ref: "page-collections", title: "Collections", status: "In Dev", priority: "high", type: "page", phase: "Development",
    assignees: ["john"], start: -6, due: 5, estimate: 600, clientVisible: true, createdDaysAgo: 40,
    custom: { "Figma frame": `${FIGMA}?node-id=31-2`, "Word count": "180" },
    page: {
      slug: "/collections", kind: "cms",
      sections: [
        { title: "Collection header", status: "Completed", component: "Hero" },
        { title: "Filterable collection grid", status: "In Dev", kind: "cms", component: "Product grid" },
        { title: "Buying guide teaser", status: "To Do", component: "CTA banner" },
      ],
      meta: { intent: "Browse every collection and filter by activity or season.", audience: "Shoppers who know what they need", primaryCta: "View collection", tone: "Clear and practical", keywords: ["kollektioner", "vandringsutrustning"], copyStatus: "drafted" },
      estimates: { design: 8, development: 14, content_seo: 3, qa: 3 },
      links: [{ kind: "staging", label: "Staging — Collections", url: `${STAGING}/collections`, clientVisible: true }],
    },
  },
  {
    ref: "page-collection-tpl", title: "Collection template", status: "In Dev", priority: "high", type: "page", phase: "Development",
    assignees: ["marko"], start: -4, due: 7, estimate: 720, clientVisible: true, createdDaysAgo: 40,
    page: {
      slug: "/collections/[slug]", kind: "cms_template",
      sections: [
        { title: "Category hero", status: "In Dev", kind: "cms", component: "Hero" },
        { title: "Products in category", status: "In Dev", kind: "cms", component: "Product grid" },
        { title: "Category SEO text", status: "Awaiting Client", kind: "cms" },
      ],
      meta: { intent: "Rank for category keywords and convert category traffic.", audience: "Organic search visitors", primaryCta: "Add to cart", tone: "Expert, helpful", keywords: ["sovsäck", "ryggsäck 40 liter", "vandringskängor dam"], copyStatus: "in_review" },
      estimates: { design: 6, development: 18, content_seo: 12, qa: 4 },
      links: [{ kind: "staging", label: "Staging — Tents", url: `${STAGING}/collections/talt`, clientVisible: true }],
    },
  },
  {
    ref: "page-product-tpl", title: "Product template", status: "In Design", priority: "urgent", type: "page", phase: "Development",
    assignees: ["maja", "marko"], watchers: ["clara"], start: -2, due: 9, estimate: 1200, clientVisible: true, createdDaysAgo: 40,
    custom: { "Figma frame": `${FIGMA}?node-id=48-7`, "Needs translation": "true" },
    page: {
      slug: "/products/[slug]", kind: "cms_template",
      sections: [
        { title: "Gallery + buy box", status: "In Dev", kind: "cms" },
        { title: "Size guide (CR)", status: "In Design", component: "Size guide" },
        { title: "Specs & materials", status: "In Dev", kind: "cms" },
        { title: "Care & repair", status: "To Do", component: "CTA banner" },
        { title: "You might also like", status: "To Do", kind: "cms", component: "Product grid" },
      ],
      meta: { intent: "Answer every buying question and reduce returns.", audience: "Shoppers comparing two or three products", primaryCta: "Add to cart", tone: "Precise, reassuring", keywords: ["vattentät jacka", "gore-tex"], copyStatus: "brief_ready" },
      estimates: { design: 14, development: 28, content_seo: 4, qa: 6 },
      links: [{ kind: "figma", label: "Figma — Product page v3", url: `${FIGMA}?node-id=48-7`, clientVisible: true }],
    },
  },
  {
    ref: "page-about", title: "About Nordvik", status: "Completed", priority: "medium", type: "page", phase: "Development",
    assignees: ["john"], start: -20, due: -12, estimate: 360, clientVisible: true, createdDaysAgo: 40,
    page: {
      slug: "/about", kind: "static",
      sections: [
        { title: "Founding story (1978, Östersund)", status: "Completed", component: "Hero" },
        { title: "Timeline", status: "Completed" },
        { title: "The team", status: "Completed" },
      ],
      meta: { intent: "Build trust through heritage.", audience: "New visitors and press", primaryCta: "Read our sustainability promise", tone: "Warm, proud, humble", keywords: ["nordvik historia"], copyStatus: "approved" },
      estimates: { design: 4, development: 5, content_seo: 3, qa: 1 },
      links: [{ kind: "staging", label: "Staging — About", url: `${STAGING}/about`, clientVisible: true }],
    },
  },
  {
    ref: "page-sustainability", title: "Sustainability", status: "Awaiting Client", priority: "high", type: "page", phase: "Content & QA",
    assignees: ["gary", "john"], watchers: ["erik"], start: -7, due: 2, estimate: 480, clientVisible: true, pendingApproval: true, createdDaysAgo: 40,
    custom: { "Word count": "950", "Needs translation": "true" },
    page: {
      slug: "/sustainability", kind: "static",
      sections: [
        { title: "Our promise", status: "Awaiting Client" },
        { title: "Repair service", status: "Completed", component: "CTA banner" },
        { title: "Materials & certifications", status: "Awaiting Client" },
        { title: "Impact report download", status: "To Do" },
      ],
      meta: { intent: "Explain the repair programme and material choices without greenwashing.", audience: "Conscious buyers, journalists", primaryCta: "Book a repair", tone: "Honest, specific, numbers-led", keywords: ["hållbar friluftsutrustning", "reparation"], copyStatus: "in_review" },
      estimates: { design: 5, development: 6, content_seo: 8, qa: 2 },
      links: [{ kind: "staging", label: "Staging — Sustainability", url: `${STAGING}/sustainability`, clientVisible: true }],
    },
  },
  {
    ref: "page-journal", title: "Journal", status: "QA by Dev", priority: "medium", type: "page", phase: "Development",
    assignees: ["marko"], start: -10, due: -1, estimate: 480, clientVisible: true, createdDaysAgo: 40,
    page: {
      slug: "/journal", kind: "cms",
      sections: [
        { title: "Featured story", status: "QA by Dev", kind: "cms", component: "Article card" },
        { title: "Article list with filters", status: "QA by Dev", kind: "cms", component: "Article card" },
      ],
      meta: { intent: "Grow organic traffic with guides and trip reports.", audience: "Hikers researching a trip", primaryCta: "Read the guide", tone: "Storytelling", keywords: ["vandringsleder sverige", "packlista fjällvandring"], copyStatus: "drafted" },
      estimates: { design: 4, development: 10, content_seo: 4, qa: 2 },
      links: [{ kind: "staging", label: "Staging — Journal", url: `${STAGING}/journal`, clientVisible: true }],
    },
  },
  {
    ref: "page-article-tpl", title: "Journal article template", status: "Approved", priority: "medium", type: "page", phase: "Development",
    assignees: ["marko"], start: -16, due: -8, estimate: 480, clientVisible: true, createdDaysAgo: 40,
    page: {
      slug: "/journal/[slug]", kind: "cms_template",
      sections: [
        { title: "Article header", status: "Approved", kind: "cms" },
        { title: "Rich text body", status: "Approved", kind: "cms" },
        { title: "Shop the story", status: "Approved", kind: "cms", component: "Product grid" },
        { title: "Related articles", status: "Approved", kind: "cms", component: "Article card" },
      ],
      meta: { intent: "Readable long-form with shoppable products.", audience: "Journal readers", primaryCta: "Shop the story", tone: "Editorial", keywords: [], copyStatus: "approved" },
      estimates: { design: 4, development: 8, qa: 2 },
    },
  },
  {
    ref: "page-stores", title: "Store locator", status: "Blocked", priority: "high", type: "page", phase: "Development",
    assignees: ["john"], start: -4, due: 4, estimate: 480, clientVisible: true, createdDaysAgo: 40,
    blockedReason: "Needs the store list CSV from Nordvik (see client deliverables).",
    page: {
      slug: "/stores", kind: "static",
      sections: [
        { title: "Map with 42 stores", status: "Blocked", kind: "cms", component: "Store map" },
        { title: "Store list + opening hours", status: "Blocked", kind: "cms" },
      ],
      meta: { intent: "Find the nearest store and today's opening hours.", audience: "Local shoppers", primaryCta: "Get directions", tone: "Practical", keywords: ["friluftsbutik stockholm"], copyStatus: "not_started" },
      estimates: { design: 3, development: 10, content_seo: 1, qa: 2 },
    },
  },
  {
    ref: "page-customer-service", title: "Customer service & FAQ", status: "To Do", priority: "medium", type: "page", phase: "Content & QA",
    assignees: ["gary"], due: 12, estimate: 360, clientVisible: true, createdDaysAgo: 40,
    page: {
      slug: "/customer-service", kind: "static",
      sections: [
        { title: "Top questions", status: "To Do", kind: "cms" },
        { title: "Returns & exchanges", status: "To Do" },
        { title: "Contact options", status: "To Do", component: "CTA banner" },
      ],
      meta: { intent: "Deflect support tickets.", audience: "Existing customers", primaryCta: "Start a return", tone: "Friendly, direct", keywords: ["retur nordvik"], copyStatus: "brief_ready" },
      estimates: { design: 2, development: 5, content_seo: 5, qa: 1 },
    },
  },
  {
    ref: "page-contact", title: "Contact", status: "To Do", priority: "low", type: "page", phase: "Content & QA",
    assignees: ["john"], due: 15, estimate: 180, clientVisible: true, createdDaysAgo: 40,
    page: {
      slug: "/contact", kind: "static",
      sections: [{ title: "Contact form (to Zendesk)", status: "To Do" }, { title: "Head office details", status: "To Do" }],
      estimates: { design: 1, development: 3, qa: 1 },
    },
  },
  {
    ref: "page-404", title: "404 — Lost in the woods", status: "Backlog", priority: "low", type: "page", phase: "Content & QA",
    assignees: [], due: null, estimate: 120, clientVisible: false, createdDaysAgo: 40,
    page: { slug: "/404", kind: "utility", sections: [{ title: "Illustration + search", status: "Backlog" }], estimates: { design: 2, development: 1 } },
  },
  {
    ref: "page-privacy", title: "Privacy & cookie policy", status: "Backlog", priority: "backlog", type: "page", phase: "Content & QA",
    assignees: [], due: null, estimate: 60, clientVisible: true, createdDaysAgo: 40,
    page: { slug: "/privacy", kind: "utility", sections: [{ title: "Policy text (from Nordvik legal)", status: "Backlog", kind: "cms" }], estimates: { development: 1, content_seo: 1 } },
  },
];

export const PROJECT_A_COMPONENTS = [
  "Navbar",
  "Footer",
  "Hero",
  "Category tiles",
  "Product grid",
  "Article card",
  "CTA banner",
  "Newsletter block",
  "Store map",
  "Size guide",
];
