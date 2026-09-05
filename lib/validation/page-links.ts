import { z } from "zod";

// F113 (missions/20260903-portal, client-portal-phase-2-plan.md item B):
// validates team-side mutations on `page_links` (20261101020000).
// Mirrors lib/validation/project-site.ts's shape exactly, including the
// same credential-shape refinement on `url` that `looksLikeCredential`
// applies there -- reused, not duplicated, since it is exactly the same
// rule the migration's `looks_like_credential` CHECK enforces on both
// `project_links.url` and `page_links.url`.

import { looksLikeCredential } from "@/lib/validation/project-site";

const labelSchema = z
  .string()
  .trim()
  .min(1, "Label is required.")
  .max(200, "Label must be 200 characters or fewer.");

const CREDENTIAL_MESSAGE =
  "This looks like a password or API key. Put it in the password manager, not here.";

const urlSchema = z
  .string()
  .trim()
  .min(1, "URL is required.")
  .max(2000, "URL must be 2000 characters or fewer.")
  .refine((value) => !looksLikeCredential(value), { message: CREDENTIAL_MESSAGE });

// Matches `is_valid_link_kind` (20261101020000) -- the same vocabulary
// `project_links.kind` uses, so the two never drift.
export const pageLinkKindSchema = z.enum([
  "staging",
  "live",
  "figma",
  "sitemap",
  "drive",
  "webflow",
  "gtm",
  "analytics",
  "search_console",
  "other",
]);

export const createPageLinkSchema = z.object({
  taskId: z.string().uuid("Invalid page."),
  kind: pageLinkKindSchema,
  label: labelSchema,
  url: urlSchema,
  clientVisible: z.boolean().optional(),
});
export type CreatePageLinkInput = z.infer<typeof createPageLinkSchema>;

export const updatePageLinkSchema = z.object({
  linkId: z.string().uuid("Invalid link."),
  kind: pageLinkKindSchema,
  label: labelSchema,
  url: urlSchema,
  clientVisible: z.boolean(),
});
export type UpdatePageLinkInput = z.infer<typeof updatePageLinkSchema>;

export const deletePageLinkSchema = z.object({
  linkId: z.string().uuid("Invalid link."),
});
export type DeletePageLinkInput = z.infer<typeof deletePageLinkSchema>;
