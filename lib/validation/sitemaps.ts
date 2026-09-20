import { z } from "zod";

// Standalone Sitemap tool, Phase 1: validation for lib/actions/sitemaps.ts.
// Shapes mirror lib/validation/architecture.ts's page/section/component
// schemas exactly (same name/slug length caps, same slug pattern) since
// this feature's kind vocabularies are a deliberate mirror of the
// existing BoardPageKind/BoardSectionKind ones -- see
// supabase/migrations/20261128010000_sitemaps.sql's header.

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export const sitemapPageKindEnum = z.enum(["static", "cms", "cms_template", "utility"]);
export const sitemapSectionKindEnum = z.enum(["static", "cms"]);

export const sitemapNameSchema = z
  .string()
  .trim()
  .min(1, "Sitemap name is required.")
  .max(200, "Sitemap name must be 200 characters or fewer.");

export const createSitemapSchema = z.object({
  workspaceId: z.string().uuid(),
  name: sitemapNameSchema,
});
export type CreateSitemapInput = z.infer<typeof createSitemapSchema>;

export const renameSitemapSchema = z.object({
  sitemapId: z.string().uuid(),
  name: sitemapNameSchema,
});
export type RenameSitemapInput = z.infer<typeof renameSitemapSchema>;

export const sitemapPageTitleSchema = z
  .string()
  .trim()
  .min(1, "Page name is required.")
  .max(200, "Page name must be 200 characters or fewer.");

export const sitemapPageSlugSchema = z
  .string()
  .trim()
  .min(1, "Page slug is required.")
  .max(200, "Page slug must be 200 characters or fewer.")
  .regex(
    slugPattern,
    "Slug can only contain lowercase letters, numbers, hyphens, and forward slashes for nested paths.",
  );

export const createSitemapPageSchema = z.object({
  sitemapId: z.string().uuid(),
  title: sitemapPageTitleSchema,
  slug: sitemapPageSlugSchema,
  kind: sitemapPageKindEnum.default("static"),
});
export type CreateSitemapPageInput = z.infer<typeof createSitemapPageSchema>;

export const reslugSitemapPageSchema = z.object({
  pageId: z.string().uuid(),
  slug: sitemapPageSlugSchema,
});
export type ReslugSitemapPageInput = z.infer<typeof reslugSitemapPageSchema>;

export const reorderSitemapPagesSchema = z.object({
  sitemapId: z.string().uuid(),
  pageIds: z
    .array(z.string().uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Page IDs must be unique",
    }),
});
export type ReorderSitemapPagesInput = z.infer<typeof reorderSitemapPagesSchema>;

export const sitemapSectionTitleSchema = z
  .string()
  .trim()
  .min(1, "Section title is required.")
  .max(200, "Section title must be 200 characters or fewer.");

export const createSitemapSectionSchema = z.object({
  pageId: z.string().uuid(),
  title: sitemapSectionTitleSchema,
  kind: sitemapSectionKindEnum.default("static"),
});
export type CreateSitemapSectionInput = z.infer<typeof createSitemapSectionSchema>;

export const reorderSitemapSectionsSchema = z.object({
  pageId: z.string().uuid(),
  sectionIds: z
    .array(z.string().uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Section IDs must be unique",
    }),
});
export type ReorderSitemapSectionsInput = z.infer<typeof reorderSitemapSectionsSchema>;

export const sitemapComponentNameSchema = z
  .string()
  .trim()
  .min(1, "Component name is required.")
  .max(200, "Component name must be 200 characters or fewer.");

export const createSitemapComponentSchema = z.object({
  sitemapId: z.string().uuid(),
  name: sitemapComponentNameSchema,
});
export type CreateSitemapComponentInput = z.infer<typeof createSitemapComponentSchema>;
