// Project B — "Nordvik — Growth Retainer" (hourly): spec.

import type { ProjectSpec } from "./build-project";
import { PROJECT_B_COMPONENTS, PROJECT_B_TASKS } from "./project-b-tasks";

export const PROJECT_B: ProjectSpec = {
  key: "NVGRO",
  name: "Nordvik — Growth Retainer",
  description:
    "Monthly retainer for nordvikoutdoor.se: CRO experiments, SEO and webshop improvements. 100 h/month at 1 150 SEK/h, unused hours roll over one month.",
  icon: "📈",
  sidebarPosition: 1,
  billingModel: "hourly",
  start: -206, // 2026-03-01
  end: null,
  createdDaysAgo: 210,
  lead: "anna",
  members: [
    { who: "anna", lead: true },
    { who: "tom" },
    { who: "john" },
    { who: "maja" },
    { who: "marko" },
    { who: "nina" },
    { who: "lisa" },
    { who: "clara" },
    { who: "erik" },
  ],
  roles: [
    { who: "anna", role: "pm", note: "Retainer lead — weekly CRO sync" },
    { who: "tom", role: "team_lead", note: "Account director" },
    { who: "marko", role: "webflow_lead", note: "Tech lead for experiments" },
    { who: "marko", role: "developer" },
    { who: "john", role: "developer", note: "SEO + front-end" },
    { who: "maja", role: "designer" },
  ],
  phases: [
    { name: "Q2 — CRO sprint", clientDescription: "Audit, experiment backlog and the first round of A/B tests on checkout and product pages.", state: "done", plannedStart: -206, plannedEnd: -100, actualStart: -206, actualEnd: -98 },
    { name: "Q3 — SEO foundations", clientDescription: "Technical SEO, structured data, Core Web Vitals and internal linking.", state: "done", plannedStart: -100, plannedEnd: -40, actualStart: -98, actualEnd: -42 },
    { name: "Webshop improvements", clientDescription: "Search, comparison, recommendations and checkout polish ahead of peak season.", state: "active", plannedStart: -40, plannedEnd: 20, actualStart: -40 },
    { name: "Black Friday readiness", clientDescription: "Landing page, gift guide and load testing so the shop is ready for 27 November.", state: "blocked", plannedStart: 7, plannedEnd: 60, actualStart: -9, blockedReason: "Waiting for the Black Friday assortment and the Centra staging environment from Nordvik." },
    { name: "Q1 2027 roadmap", clientDescription: "Planning workshop and next quarter's experiment backlog.", state: "not_started", plannedStart: 70, plannedEnd: 100 },
  ],
  components: PROJECT_B_COMPONENTS,
  customFields: [
    { name: "Experiment ID", type: "text" },
    { name: "Expected uplift %", type: "number" },
    { name: "GA4 report", type: "url" },
    { name: "Quick win", type: "checkbox" },
  ],
  tasks: PROJECT_B_TASKS,
  dependencies: [
    ["b-audit", "b-test-checkout"],
    ["b-test-checkout", "b-test-sticky"],
    ["b-keywords", "b-internal-links"],
    ["b-cwv", "b-image-cdn"],
    ["b-compare", "b-search"],
    ["b-bf-assortment", "b-bf-landing"],
    ["b-bf-loadtest", "b-bf-landing"],
    ["b-address", "b-bf-loadtest"],
  ],
  comments: [
    { task: "b-test-checkout", by: "marko", daysAgo: 150, hour: 10, parts: ["Test concluded: one-page checkout wins with +8.4% completion at 95% significance. Rolling out to 100%."], reactions: [["anna", "🎉"], ["clara", "🎉"], ["tom", "🚀"]] },
    { task: "b-test-checkout", by: "clara", daysAgo: 149, hour: 9, parts: ["Fantastic result — our CEO loved the chart in the report!"] },
    { task: "b-test-trust", by: "anna", daysAgo: 110, hour: 15, parts: ["Stopping this one — flat after 14 days and we need the traffic for the sticky add-to-cart test."] },
    { task: "b-cwv", by: "marko", daysAgo: 50, hour: 16, parts: ["LCP on category pages is down from 4.1 s to 2.2 s (CrUX, p75 mobile). Details in the Results tab."], reactions: [["clara", "🚀"], ["john", "👍"]] },
    { task: "b-compare", by: "maja", daysAgo: 6, hour: 14, parts: (p) => ["Variant design is ready: sticky compare bar + drawer. ", { mention: p.clara }, " would love a quick look before we build."] },
    { task: "b-compare", by: "clara", daysAgo: 5, hour: 10, parts: ["Looks great. Can the drawer show weight and waterproof rating first? Those are what customers ask about."] },
    { task: "b-compare", by: "marko", daysAgo: 1, hour: 17, internal: true, parts: (p) => ["Build is ~70% done. ", { mention: p.nina }, " can you reserve Friday morning for device QA?"], reactions: [["nina", "👍"]] },
    { task: "b-reviews", by: "john", daysAgo: 3, hour: 11, parts: (p) => ["Two placements are live on staging. ", { mention: p.erik }, " which one do you prefer — A (below buy box) or B (tab)?"] },
    { task: "b-reviews", by: "erik", daysAgo: 1, hour: 16, parts: ["Leaning towards A, but I want to check with Clara. We'll decide by Thursday."] },
    { task: "b-address", by: "marko", daysAgo: 7, hour: 10, parts: (p) => [{ mention: p.erik }, " we're ready to integrate as soon as the PostNord subscription is active — could you check with procurement?"] },
    { task: "b-bug-search", by: "clara", daysAgo: 0, hour: 8, parts: ["Customers are emailing us that searching ‘ryggsäck’ shows nothing. ‘ryggsack’ works. Urgent please 🙏"] },
    { task: "b-bug-search", by: "john", daysAgo: 0, hour: 9, parts: ["On it — looks like the index strips å/ä/ö. Hotfix today, proper fix comes with the Algolia search."], reactions: [["clara", "❤️"]] },
    { task: "b-bf-assortment", by: "anna", daysAgo: 2, hour: 13, parts: (p) => [{ mention: p.clara }, " we need the BF assortment and discount levels by 30 Sep to hit the landing page timeline."] },
    { task: "b-ctl", by: "nina", daysAgo: 1, hour: 15, internal: true, parts: ["Recommendations show sold-out variants on 3 products. Back to dev."] },
    { task: "b-image-cdn", by: "maja", daysAgo: 1, hour: 10, internal: true, parts: ["AVIF looks great except on the white-background packshots — slight banding. Can we raise quality to 70 for those?"] },
    { task: "b-report-aug", by: "clara", daysAgo: 15, hour: 11, parts: ["Thanks for the walkthrough. Can you add returning-customer revenue next month?"], reactions: [["anna", "👍"]] },
  ],
  timePlan: {
    seed: 23,
    periods: [
      { from: -206, to: -176, hoursPerWeek: 21 }, // March
      { from: -175, to: -146, hoursPerWeek: 25 }, // April
      { from: -145, to: -115, hoursPerWeek: 24 }, // May
      { from: -114, to: -85, hoursPerWeek: 21 }, // June
      { from: -84, to: -54, hoursPerWeek: 14 }, // July (holidays)
      { from: -53, to: -23, hoursPerWeek: 22 }, // August
      { from: -22, to: 0, hoursPerWeek: 27 }, // September
    ],
  },
  attachments: [
    { task: "b-test-checkout", by: "marko", name: "exp-001-results.pdf", kind: "pdf", daysAgo: 150 },
    { task: "b-compare", by: "maja", name: "compare-drawer-v1.png", kind: "png", daysAgo: 6, accent: "#264653" },
    { task: "b-cwv", by: "marko", name: "crux-lcp-category.csv", kind: "csv", daysAgo: 50 },
    { task: "b-bug-search", by: "clara", name: "search-empty-state.png", kind: "png", daysAgo: 0, accent: "#9a3412" },
    { task: "b-report-aug", by: "anna", name: "nordvik-report-august-2026.pdf", kind: "pdf", daysAgo: 16 },
  ],
};
