// Chat content (project channel conversations) — a short, plausible thread
// per showcase project. Mirrors the shape consumed by seedChannelMessages
// in records-common.ts.

import type { People, PersonKey } from "./accounts";
import type { Inline } from "./util";
import type { FileKind } from "./storage";

export type ChatMessage = {
  by: PersonKey;
  parts: Inline[] | ((p: People) => Inline[]);
  daysAgo: number;
  hour?: number;
  minute?: number;
  edited?: boolean;
  reactions?: Array<[PersonKey, string]>;
  file?: { name: string; kind: FileKind; accent?: string };
  replies?: ChatMessage[];
};

export const PROJECT_CHAT: Record<string, ChatMessage[]> = {
  NVWEB: [
    {
      by: "tom",
      parts: ["Kickoff notes are up in Docs — nice work everyone. Nordvik loved the direction Maja showed."],
      daysAgo: 96,
      hour: 9,
      minute: 12,
      reactions: [["anna", "🎉"], ["maja", "🙌"]],
    },
    {
      by: "maja",
      parts: ["Thanks! First round of homepage explorations are in Figma, link in the brief doc."],
      daysAgo: 88,
      hour: 14,
      minute: 30,
      replies: [
        {
          by: "anna",
          parts: ["Looks great — can we get a version with the repair story higher up on mobile?"],
          daysAgo: 88,
          hour: 15,
          minute: 5,
        },
        {
          by: "maja",
          parts: ["Yep, already sketching that variant, will have it tomorrow."],
          daysAgo: 88,
          hour: 15,
          minute: 40,
          edited: true,
        },
      ],
    },
    {
      by: "john",
      parts: [
        "Pushed the Centra → Webflow product sync spike. Redirect map for the top-400 URLs is attached.",
      ],
      daysAgo: 40,
      hour: 11,
      minute: 0,
      file: { name: "redirect-map.csv", kind: "csv", accent: "#3670e1" },
    },
    {
      by: "marko",
      parts: (p: People) => [{ mention: p.nina }, " staging build for the store locator is deployed, ready for a QA pass."],
      daysAgo: 20,
      hour: 16,
      minute: 15,
    },
    {
      by: "nina",
      parts: ["Found two issues on mobile Safari — filed as tasks, both marked high priority."],
      daysAgo: 18,
      hour: 10,
      minute: 45,
      reactions: [["marko", "👀"]],
    },
    {
      by: "tom",
      parts: ["Reminder: launch target is 30 October, before Black Friday. Let's keep an eye on the redirect QA."],
      daysAgo: 6,
      hour: 9,
      minute: 0,
    },
  ],
  NVGRO: [
    {
      by: "anna",
      parts: ["Kicking off the retainer — weekly CRO sync is Tuesdays 10:00, calendar invite sent."],
      daysAgo: 204,
      hour: 9,
      minute: 30,
    },
    {
      by: "marko",
      parts: ["One-page checkout experiment is live. Sample size should get us to significance in ~2 weeks."],
      daysAgo: 150,
      hour: 13,
      minute: 0,
      reactions: [["anna", "🚀"]],
      replies: [
        {
          by: "anna",
          parts: ["Nice. Let's make sure we're only reading it after both weekends land."],
          daysAgo: 150,
          hour: 13,
          minute: 20,
        },
      ],
    },
    {
      by: "anna",
      parts: [
        "One-page checkout finished at +8.4% completion, rolling it out to 100%. Report attached.",
      ],
      daysAgo: 118,
      hour: 10,
      minute: 0,
      file: { name: "experiment-report.pdf", kind: "pdf", accent: "#8b5cf6" },
    },
    {
      by: "john",
      parts: ["LCP on category pages is down to 2.2s after the image pipeline change — CWV report attached."],
      daysAgo: 30,
      hour: 15,
      minute: 10,
      file: { name: "core-web-vitals.csv", kind: "csv", accent: "#10b981" },
    },
    {
      by: "anna",
      parts: (p: People) => [{ mention: p.marko }, " can we start the product comparison test next week per the August report?"],
      daysAgo: 15,
      hour: 11,
      minute: 0,
    },
    {
      by: "marko",
      parts: ["On it — targeting 2 Oct start once QA signs off."],
      daysAgo: 14,
      hour: 9,
      minute: 45,
      reactions: [["anna", "👍"]],
    },
  ],
};
