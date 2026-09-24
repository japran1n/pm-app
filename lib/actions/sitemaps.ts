"use server";

// Standalone Sitemap tool, Phase 1: write side for sitemaps that are NOT
// tied to any project (supabase/migrations/20261128010000_sitemaps.sql).
// This is a deliberately parallel, separate write path from
// lib/actions/architecture/* -- it never touches `tasks` or
// `page_components`, and lib/actions/architecture/* is never imported
// here.
//
// Pattern mirrors lib/actions/architecture/pages.ts exactly: Zod-validated
// input, membership + write permission re-checked server-side (defense in
// depth against RLS drift), an admin client for the actual mutation once
// membership is independently verified, discriminated-union return,
// generic user-facing errors with details only logged server-side.
//
// Every child-entity action (page/section/component/share) resolves its
// owning sitemap's workspace_id server-side via the admin client, never
// trusting a workspace id supplied by the caller -- same "never trust a
// client-supplied workspace id" reasoning pages.ts's own header comment
// gives.
import { generateShareToken } from "@/lib/sitemaps/share-token";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canTeamWrite } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/actions/authz";
import {
  createSitemapSchema,
  renameSitemapSchema,
  createSitemapPageSchema,
  reslugSitemapPageSchema,
  reorderSitemapPagesSchema,
  createSitemapSectionSchema,
  reorderSitemapSectionsSchema,
  createSitemapComponentSchema,
  sitemapNameSchema,
  sitemapPageTitleSchema,
  sitemapSectionTitleSchema,
  sitemapComponentNameSchema,
  sitemapPageKindEnum,
  sitemapPageSlugSchema,
  sitemapSectionKindEnum,
} from "@/lib/validation/sitemaps";

type AdminClient = ReturnType<typeof createAdminClient>;

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";


// The sitemap tool is a team tool: owner/admin/member write, everyone
// else (viewer, guest, client) is refused -- the same allow-list the RLS
// policies in supabase/migrations/20261130100000_sitemaps_role_aware_rls.sql
// enforce. `canWrite` would have admitted guests.
async function requireWriteAccess(
  admin: AdminClient,
  workspaceId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const membership = await requireActiveMembership(admin, workspaceId, userId);
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  if (!canTeamWrite({ role: membership.role })) {
    return { ok: false, error: "You don't have permission to make changes." };
  }
  return { ok: true };
}

async function resolveSitemapWorkspace(
  admin: AdminClient,
  sitemapId: string,
): Promise<{ id: string; workspace_id: string } | null> {
  const { data, error } = await admin
    .from("sitemaps")
    .select("id, workspace_id")
    .eq("id", sitemapId)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

type SitemapRel = { id: string; workspace_id: string; archived_at: string | null };

function firstRel<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

async function resolvePageSitemapWorkspace(
  admin: AdminClient,
  pageId: string,
): Promise<{ pageId: string; sitemapId: string; workspaceId: string } | null> {
  const { data, error } = await admin
    .from("sitemap_pages")
    .select("id, sitemap_id, sitemaps(id, workspace_id, archived_at)")
    .eq("id", pageId)
    .maybeSingle();

  if (error || !data) return null;
  const sitemapRow = firstRel(data.sitemaps as SitemapRel | SitemapRel[] | null);
  if (!sitemapRow || sitemapRow.archived_at !== null) return null;

  return { pageId: data.id, sitemapId: data.sitemap_id, workspaceId: sitemapRow.workspace_id };
}

// Batch scope resolution for the flat board actions below. Every id the
// caller names must exist, and all of them must belong to ONE live
// (non-archived) sitemap -- otherwise the whole batch is refused. The
// write access check then runs against that sitemap's workspace, so no id
// in the batch can reach a row the caller was never authorized for.
// Returns null (fail closed) on any lookup error, missing id, archived
// sitemap or mixed sitemaps.
function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function resolvePagesSitemapScope(
  admin: AdminClient,
  pageIds: string[],
): Promise<{ sitemapId: string; workspaceId: string } | null> {
  const ids = uniqueIds(pageIds);
  if (ids.length === 0) return null;

  const { data, error } = await admin
    .from("sitemap_pages")
    .select("id, sitemap_id, sitemaps(id, workspace_id, archived_at)")
    .in("id", ids);

  if (error || !data || data.length !== ids.length) return null;

  const sitemapIds = new Set(data.map((row) => row.sitemap_id));
  if (sitemapIds.size !== 1) return null;

  const sitemapRow = firstRel(data[0].sitemaps as SitemapRel | SitemapRel[] | null);
  if (!sitemapRow || sitemapRow.archived_at !== null) return null;

  return { sitemapId: data[0].sitemap_id, workspaceId: sitemapRow.workspace_id };
}

type SectionPageRel = {
  id: string;
  sitemap_id: string;
  sitemaps: SitemapRel | SitemapRel[] | null;
};

async function resolveSectionsSitemapScope(
  admin: AdminClient,
  sectionIds: string[],
): Promise<{ sitemapId: string; workspaceId: string } | null> {
  const ids = uniqueIds(sectionIds);
  if (ids.length === 0) return null;

  const { data, error } = await admin
    .from("sitemap_sections")
    .select("id, page_id, sitemap_pages(id, sitemap_id, sitemaps(id, workspace_id, archived_at))")
    .in("id", ids);

  if (error || !data || data.length !== ids.length) return null;

  const pages = data.map((row) =>
    firstRel(row.sitemap_pages as SectionPageRel | SectionPageRel[] | null),
  );
  if (pages.some((page) => !page)) return null;

  const sitemapIds = new Set(pages.map((page) => page!.sitemap_id));
  if (sitemapIds.size !== 1) return null;

  const sitemapRow = firstRel(pages[0]!.sitemaps);
  if (!sitemapRow || sitemapRow.archived_at !== null) return null;

  return { sitemapId: pages[0]!.sitemap_id, workspaceId: sitemapRow.workspace_id };
}

function isValidPositionUpdates(
  updates: unknown,
): updates is { id: string; position: number }[] {
  return (
    Array.isArray(updates) &&
    updates.length > 0 &&
    updates.length <= 1000 &&
    updates.every(
      (update) =>
        typeof update === "object" &&
        update !== null &&
        typeof (update as { id?: unknown }).id === "string" &&
        Number.isInteger((update as { position?: unknown }).position) &&
        (update as { position: number }).position >= 0,
    )
  );
}

function revalidateSitemaps() {
  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("sitemaps: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

async function guardedAdmin(): Promise<
  | { ok: true; admin: AdminClient; userId: string }
  | { ok: false; error: string }
> {
  const { user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to do that." };
  }
  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();
  return { ok: true, admin, userId: user.id };
}

// ---------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------

export async function createSitemap(
  workspaceId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSitemapSchema.safeParse({ workspaceId, name });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const access = await requireWriteAccess(ctx.admin, parsed.data.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { data, error } = await ctx.admin
    .from("sitemaps")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("createSitemap: insert failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: data.id } };
}

export async function renameSitemap(
  sitemapId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = renameSitemapSchema.safeParse({ sitemapId, name });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, parsed.data.sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { error } = await ctx.admin
    .from("sitemaps")
    .update({ name: parsed.data.name })
    .eq("id", sitemap.id);

  if (error) {
    logger.error("renameSitemap: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: sitemap.id } };
}

export async function archiveSitemap(sitemapId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { error } = await ctx.admin
    .from("sitemaps")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", sitemap.id);

  if (error) {
    logger.error("archiveSitemap: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: sitemap.id } };
}

// Deep-copies a sitemap: its pages (new ids, same slugs/kinds/positions),
// its components (new ids, same names/positions), and its sections (new
// ids, re-pointed at the copied page/component ids -- never the
// originals). Runs as three sequential inserts (pages, components,
// sections) because sections need the id maps from the first two before
// they can be built; no N+1 (each entity type is a single bulk insert).
export async function duplicateSitemap(
  sitemapId: string,
  name?: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { data: original, error: originalError } = await ctx.admin
    .from("sitemaps")
    .select("name")
    .eq("id", sitemap.id)
    .single();

  if (originalError || !original) {
    return { ok: false, error: "Sitemap not found." };
  }

  const newName = name?.trim() || `${original.name} (copy)`;
  const nameCheck = sitemapNameSchema.safeParse(newName);
  if (!nameCheck.success) {
    return { ok: false, error: nameCheck.error.issues[0]?.message ?? "Enter a valid name." };
  }

  const { data: newSitemap, error: insertError } = await ctx.admin
    .from("sitemaps")
    .insert({ workspace_id: sitemap.workspace_id, name: nameCheck.data, created_by: ctx.userId })
    .select("id")
    .single();

  if (insertError || !newSitemap) {
    logger.error("duplicateSitemap: sitemap insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const [pagesResult, componentsResult] = await Promise.all([
    ctx.admin.from("sitemap_pages").select("id, title, slug, kind, position").eq("sitemap_id", sitemap.id),
    ctx.admin.from("sitemap_components").select("id, name, position").eq("sitemap_id", sitemap.id),
  ]);

  if (pagesResult.error || componentsResult.error) {
    logger.error("duplicateSitemap: failed to load source rows", {
      pagesError: pagesResult.error,
      componentsError: componentsResult.error,
    });
    return { ok: false, error: GENERIC_ERROR };
  }

  const componentIdMap = new Map<string, string>();
  if ((componentsResult.data ?? []).length > 0) {
    const { data: insertedComponents, error: componentInsertError } = await ctx.admin
      .from("sitemap_components")
      .insert(
        (componentsResult.data ?? []).map((c) => ({
          sitemap_id: newSitemap.id,
          name: c.name,
          position: c.position,
        })),
      )
      .select("id, name, position");

    if (componentInsertError || !insertedComponents) {
      logger.error("duplicateSitemap: component insert failed", { error: componentInsertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    // Map old id -> new id by matching (name, position) pairs, unique
    // within a single sitemap's component list by construction (no two
    // components share a position).
    const originalComponents = componentsResult.data ?? [];
    insertedComponents.forEach((inserted, index) => {
      const original = originalComponents[index];
      if (original) componentIdMap.set(original.id, inserted.id);
    });
  }

  const pageIdMap = new Map<string, string>();
  const originalPages = pagesResult.data ?? [];
  if (originalPages.length > 0) {
    const { data: insertedPages, error: pageInsertError } = await ctx.admin
      .from("sitemap_pages")
      .insert(
        originalPages.map((p) => ({
          sitemap_id: newSitemap.id,
          title: p.title,
          slug: p.slug,
          kind: p.kind,
          position: p.position,
        })),
      )
      .select("id, title, slug, position");

    if (pageInsertError || !insertedPages) {
      logger.error("duplicateSitemap: page insert failed", { error: pageInsertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    insertedPages.forEach((inserted, index) => {
      const original = originalPages[index];
      if (original) pageIdMap.set(original.id, inserted.id);
    });

    const { data: sectionRows, error: sectionsError } = await ctx.admin
      .from("sitemap_sections")
      .select("page_id, title, kind, component_id, position")
      .in("page_id", originalPages.map((p) => p.id));

    if (sectionsError) {
      logger.error("duplicateSitemap: failed to load sections", { error: sectionsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    if ((sectionRows ?? []).length > 0) {
      const { error: sectionInsertError } = await ctx.admin.from("sitemap_sections").insert(
        (sectionRows ?? []).map((s) => ({
          page_id: pageIdMap.get(s.page_id)!,
          title: s.title,
          kind: s.kind,
          component_id: s.component_id ? componentIdMap.get(s.component_id) ?? null : null,
          position: s.position,
        })),
      );

      if (sectionInsertError) {
        logger.error("duplicateSitemap: section insert failed", { error: sectionInsertError });
        return { ok: false, error: GENERIC_ERROR };
      }
    }
  }

  revalidateSitemaps();
  return { ok: true, data: { id: newSitemap.id } };
}

// ---------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------

export async function createSitemapPage(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSitemapPageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter valid page details." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, parsed.data.sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { data: existingPage, error: existingPageError } = await ctx.admin
    .from("sitemap_pages")
    .select("id")
    .eq("sitemap_id", sitemap.id)
    .eq("slug", parsed.data.slug)
    .maybeSingle();

  if (existingPageError) {
    logger.error("createSitemapPage: slug check failed", { error: existingPageError });
    return { ok: false, error: GENERIC_ERROR };
  }

  if (existingPage) {
    return { ok: false, error: "A page with this slug already exists." };
  }

  const { count: existingPageCount, error: countError } = await ctx.admin
    .from("sitemap_pages")
    .select("id", { count: "exact", head: true })
    .eq("sitemap_id", sitemap.id);

  if (countError) {
    logger.error("createSitemapPage: count failed", { error: countError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: inserted, error: insertError } = await ctx.admin
    .from("sitemap_pages")
    .insert({
      sitemap_id: sitemap.id,
      title: parsed.data.title,
      slug: parsed.data.slug,
      kind: parsed.data.kind,
      position: existingPageCount ?? 0,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    logger.error("createSitemapPage: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: inserted.id } };
}

export async function renameSitemapPage(
  pageId: string,
  title: string,
): Promise<ActionResult<{ id: string }>> {
  const titleCheck = sitemapPageTitleSchema.safeParse(title);
  if (!titleCheck.success) {
    return { ok: false, error: titleCheck.error.issues[0]?.message ?? "Enter a valid name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const page = await resolvePageSitemapWorkspace(ctx.admin, pageId);
  if (!page) return { ok: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, page.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { error } = await ctx.admin
    .from("sitemap_pages")
    .update({ title: titleCheck.data })
    .eq("id", page.pageId);

  if (error) {
    logger.error("renameSitemapPage: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: page.pageId } };
}

export async function reslugSitemapPage(
  pageId: string,
  slug: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = reslugSitemapPageSchema.safeParse({ pageId, slug });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid slug." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const page = await resolvePageSitemapWorkspace(ctx.admin, parsed.data.pageId);
  if (!page) return { ok: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, page.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { data: existingPage, error: existingPageError } = await ctx.admin
    .from("sitemap_pages")
    .select("id")
    .eq("sitemap_id", page.sitemapId)
    .eq("slug", parsed.data.slug)
    .neq("id", page.pageId)
    .maybeSingle();

  if (existingPageError) {
    logger.error("reslugSitemapPage: slug check failed", { error: existingPageError });
    return { ok: false, error: GENERIC_ERROR };
  }

  if (existingPage) {
    return { ok: false, error: "A page with this slug already exists." };
  }

  const { error } = await ctx.admin
    .from("sitemap_pages")
    .update({ slug: parsed.data.slug })
    .eq("id", page.pageId);

  if (error) {
    logger.error("reslugSitemapPage: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: page.pageId } };
}

export async function deleteSitemapPage(pageId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const page = await resolvePageSitemapWorkspace(ctx.admin, pageId);
  if (!page) return { ok: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, page.workspaceId, ctx.userId);
  if (!access.ok) return access;

  // Sections cascade via the FK (on delete cascade); no manual cleanup.
  const { error } = await ctx.admin.from("sitemap_pages").delete().eq("id", page.pageId);

  if (error) {
    logger.error("deleteSitemapPage: delete failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: page.pageId } };
}

export async function reorderSitemapPages(
  sitemapId: string,
  pageIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const parsed = reorderSitemapPagesSchema.safeParse({ sitemapId, pageIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid page order." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, parsed.data.sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { data: pages, error: pagesError } = await ctx.admin
    .from("sitemap_pages")
    .select("id")
    .eq("sitemap_id", sitemap.id);

  if (pagesError) {
    logger.error("reorderSitemapPages: failed to load pages", { error: pagesError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const validIds = new Set((pages ?? []).map((p) => p.id));
  if (parsed.data.pageIds.some((id) => !validIds.has(id))) {
    return { ok: false, error: "One or more pages do not belong to this sitemap." };
  }

  const updates = await Promise.all(
    parsed.data.pageIds.map((id, index) =>
      ctx.admin.from("sitemap_pages").update({ position: index }).eq("id", id),
    ),
  );

  const failed = updates.find((result) => result.error);
  if (failed?.error) {
    logger.error("reorderSitemapPages: update failed", { error: failed.error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { count: parsed.data.pageIds.length } };
}

// ---------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------

export async function createSitemapSection(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSitemapSectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid section name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const page = await resolvePageSitemapWorkspace(ctx.admin, parsed.data.pageId);
  if (!page) return { ok: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, page.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { count: existingSectionCount, error: countError } = await ctx.admin
    .from("sitemap_sections")
    .select("id", { count: "exact", head: true })
    .eq("page_id", page.pageId);

  if (countError) {
    logger.error("createSitemapSection: count failed", { error: countError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: inserted, error: insertError } = await ctx.admin
    .from("sitemap_sections")
    .insert({
      page_id: page.pageId,
      title: parsed.data.title,
      kind: parsed.data.kind,
      position: existingSectionCount ?? 0,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    logger.error("createSitemapSection: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: inserted.id } };
}

async function resolveSectionPageSitemapWorkspace(admin: AdminClient, sectionId: string) {
  const { data, error } = await admin
    .from("sitemap_sections")
    .select("id, page_id, sitemap_pages(id, sitemap_id, sitemaps(id, workspace_id, archived_at))")
    .eq("id", sectionId)
    .maybeSingle();

  if (error || !data) return null;

  const pageRow = firstRel(data.sitemap_pages as SectionPageRel | SectionPageRel[] | null);
  if (!pageRow) return null;
  const sitemapRow = firstRel(pageRow.sitemaps);
  if (!sitemapRow || sitemapRow.archived_at !== null) return null;

  return {
    sectionId: data.id,
    pageId: data.page_id,
    sitemapId: pageRow.sitemap_id,
    workspaceId: sitemapRow.workspace_id,
  };
}

export async function renameSitemapSection(
  sectionId: string,
  title: string,
): Promise<ActionResult<{ id: string }>> {
  const titleCheck = sitemapSectionTitleSchema.safeParse(title);
  if (!titleCheck.success) {
    return { ok: false, error: titleCheck.error.issues[0]?.message ?? "Enter a valid name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  if (!section) return { ok: false, error: "Section not found." };

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { error } = await ctx.admin
    .from("sitemap_sections")
    .update({ title: titleCheck.data })
    .eq("id", section.sectionId);

  if (error) {
    logger.error("renameSitemapSection: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: section.sectionId } };
}

export async function deleteSitemapSection(sectionId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  if (!section) return { ok: false, error: "Section not found." };

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { error } = await ctx.admin.from("sitemap_sections").delete().eq("id", section.sectionId);

  if (error) {
    logger.error("deleteSitemapSection: delete failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: section.sectionId } };
}

export async function reorderSitemapSections(
  pageId: string,
  sectionIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const parsed = reorderSitemapSectionsSchema.safeParse({ pageId, sectionIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid section order." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const page = await resolvePageSitemapWorkspace(ctx.admin, parsed.data.pageId);
  if (!page) return { ok: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, page.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { data: sections, error: sectionsError } = await ctx.admin
    .from("sitemap_sections")
    .select("id")
    .eq("page_id", page.pageId);

  if (sectionsError) {
    logger.error("reorderSitemapSections: failed to load sections", { error: sectionsError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const validIds = new Set((sections ?? []).map((s) => s.id));
  if (parsed.data.sectionIds.some((id) => !validIds.has(id))) {
    return { ok: false, error: "One or more sections do not belong to this page." };
  }

  const updates = await Promise.all(
    parsed.data.sectionIds.map((id, index) =>
      ctx.admin.from("sitemap_sections").update({ position: index }).eq("id", id),
    ),
  );

  const failed = updates.find((result) => result.error);
  if (failed?.error) {
    logger.error("reorderSitemapSections: update failed", { error: failed.error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { count: parsed.data.sectionIds.length } };
}

// ---------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------

export async function createSitemapComponent(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSitemapComponentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid component name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, parsed.data.sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { count: existingCount, error: countError } = await ctx.admin
    .from("sitemap_components")
    .select("id", { count: "exact", head: true })
    .eq("sitemap_id", sitemap.id);

  if (countError) {
    logger.error("createSitemapComponent: count failed", { error: countError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: inserted, error: insertError } = await ctx.admin
    .from("sitemap_components")
    .insert({ sitemap_id: sitemap.id, name: parsed.data.name, position: existingCount ?? 0 })
    .select("id")
    .single();

  if (insertError || !inserted) {
    logger.error("createSitemapComponent: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: inserted.id } };
}

async function resolveComponentSitemapWorkspace(admin: AdminClient, componentId: string) {
  const { data, error } = await admin
    .from("sitemap_components")
    .select("id, sitemap_id, sitemaps(id, workspace_id, archived_at)")
    .eq("id", componentId)
    .maybeSingle();

  if (error || !data) return null;
  const sitemapRow = firstRel(data.sitemaps as SitemapRel | SitemapRel[] | null);
  if (!sitemapRow || sitemapRow.archived_at !== null) return null;

  return { componentId: data.id, sitemapId: data.sitemap_id, workspaceId: sitemapRow.workspace_id };
}

export async function renameSitemapComponent(
  componentId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const nameCheck = sitemapComponentNameSchema.safeParse(name);
  if (!nameCheck.success) {
    return { ok: false, error: nameCheck.error.issues[0]?.message ?? "Enter a valid name." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const component = await resolveComponentSitemapWorkspace(ctx.admin, componentId);
  if (!component) return { ok: false, error: "Component not found." };

  const access = await requireWriteAccess(ctx.admin, component.workspaceId, ctx.userId);
  if (!access.ok) return access;

  const { error } = await ctx.admin
    .from("sitemap_components")
    .update({ name: nameCheck.data })
    .eq("id", component.componentId);

  if (error) {
    logger.error("renameSitemapComponent: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: component.componentId } };
}

export async function deleteSitemapComponent(
  componentId: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const component = await resolveComponentSitemapWorkspace(ctx.admin, componentId);
  if (!component) return { ok: false, error: "Component not found." };

  const access = await requireWriteAccess(ctx.admin, component.workspaceId, ctx.userId);
  if (!access.ok) return access;

  // Sections linked to this component fall back to component_id = null
  // via the FK's `on delete set null` -- the section itself is never
  // deleted just because its component was.
  const { error } = await ctx.admin.from("sitemap_components").delete().eq("id", component.componentId);

  if (error) {
    logger.error("deleteSitemapComponent: delete failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: component.componentId } };
}

// ---------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------

async function findActiveShareToken(
  admin: AdminClient,
  sitemapId: string,
): Promise<{ ok: true; token: string | null } | { ok: false }> {
  const { data, error } = await admin
    .from("sitemap_shares")
    .select("token")
    .eq("sitemap_id", sitemapId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    logger.error("createSitemapShare: active share lookup failed", { error });
    return { ok: false };
  }
  return { ok: true, token: data?.token ?? null };
}

export async function createSitemapShare(
  sitemapId: string,
): Promise<ActionResult<{ token: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  // At most one active share per sitemap (enforced by the partial unique
  // index sitemap_shares_one_active_per_sitemap_idx): a second "create"
  // returns the link that is already live instead of minting another.
  const existing = await findActiveShareToken(ctx.admin, sitemap.id);
  if (!existing.ok) return { ok: false, error: GENERIC_ERROR };
  if (existing.token) return { ok: true, data: { token: existing.token } };

  const token = generateShareToken();

  const { error } = await ctx.admin.from("sitemap_shares").insert({
    sitemap_id: sitemap.id,
    token,
  });

  if (error) {
    if (error.code === "23505") {
      // Lost a race with a concurrent create -- hand back the winner's link.
      const winner = await findActiveShareToken(ctx.admin, sitemap.id);
      if (winner.ok && winner.token) return { ok: true, data: { token: winner.token } };
    }
    logger.error("createSitemapShare: insert failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { ok: true, data: { token } };
}

// ---------------------------------------------------------------------
// Board-UI parity actions (Phase 2: `ArchitectureCoreActions` shape,
// lib/architecture/actions-context.tsx). The board leaf components call
// these with the exact same flat signatures the project-backed
// lib/actions/architecture/{pages,sections}.ts export (updates arrays
// with no page/sitemap id threaded through, a "move to page" with an
// explicit target position, etc.) -- these thin wrappers exist so the
// sitemap tool can supply matching functions without changing the shared
// board UI's call sites. Each one still re-verifies write access
// server-side before touching a row, same as every other action above.
// ---------------------------------------------------------------------

export async function reorderSitemapSectionsFlat(
  updates: { id: string; position: number }[],
): Promise<MutationResult> {
  if (!isValidPositionUpdates(updates)) {
    return { success: false, error: "No sections to reorder." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  // Every id in the batch, not just the first: all sections must belong to
  // one live sitemap the caller may write, or nothing is written.
  const scope = await resolveSectionsSitemapScope(
    ctx.admin,
    updates.map((update) => update.id),
  );
  if (!scope) return { success: false, error: "Section not found." };

  const access = await requireWriteAccess(ctx.admin, scope.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const results = await Promise.all(
    updates.map((update) =>
      ctx.admin.from("sitemap_sections").update({ position: update.position }).eq("id", update.id),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    logger.error("reorderSitemapSectionsFlat: update failed", { error: failed.error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function changeSectionKindSitemap(
  sectionId: string,
  kind: string,
): Promise<MutationResult> {
  const kindCheck = sitemapSectionKindEnum.safeParse(kind);
  if (!kindCheck.success) {
    return { success: false, error: "Invalid section kind." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  if (!section) return { success: false, error: "Section not found." };

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { error } = await ctx.admin
    .from("sitemap_sections")
    .update({ kind: kindCheck.data })
    .eq("id", section.sectionId);

  if (error) {
    logger.error("changeSectionKindSitemap: update failed", { error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function moveSitemapSectionToPage(
  sectionId: string,
  newPageId: string,
  position: number,
): Promise<MutationResult> {
  if (!Number.isInteger(position) || position < 0) {
    return { success: false, error: "Invalid position." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  if (!section) return { success: false, error: "Section not found." };

  // Same sitemap, not merely same workspace: a section never hops between
  // sitemaps (its component link would dangle into the other sitemap).
  const newPage = await resolvePageSitemapWorkspace(ctx.admin, newPageId);
  if (!newPage || newPage.sitemapId !== section.sitemapId) {
    return { success: false, error: "Page not found." };
  }

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { error } = await ctx.admin
    .from("sitemap_sections")
    .update({ page_id: newPage.pageId, position })
    .eq("id", section.sectionId);

  if (error) {
    logger.error("moveSitemapSectionToPage: update failed", { error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function changeSitemapPageKind(
  pageId: string,
  kind: string,
): Promise<MutationResult> {
  const kindCheck = sitemapPageKindEnum.safeParse(kind);
  if (!kindCheck.success) {
    return { success: false, error: "Invalid page kind." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const page = await resolvePageSitemapWorkspace(ctx.admin, pageId);
  if (!page) return { success: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, page.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { error } = await ctx.admin
    .from("sitemap_pages")
    .update({ kind: kindCheck.data })
    .eq("id", page.pageId);

  if (error) {
    logger.error("changeSitemapPageKind: update failed", { error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function reorderSitemapPagesFlat(
  updates: { id: string; position: number }[],
): Promise<MutationResult> {
  if (!isValidPositionUpdates(updates)) {
    return { success: false, error: "No pages to reorder." };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  // Every id in the batch, not just the first: all pages must belong to
  // one live sitemap the caller may write, or nothing is written.
  const scope = await resolvePagesSitemapScope(
    ctx.admin,
    updates.map((update) => update.id),
  );
  if (!scope) return { success: false, error: "Page not found." };

  const access = await requireWriteAccess(ctx.admin, scope.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const results = await Promise.all(
    updates.map((update) =>
      ctx.admin
        .from("sitemap_pages")
        .update({ position: update.position })
        .eq("id", update.id)
        .eq("sitemap_id", scope.sitemapId),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    logger.error("reorderSitemapPagesFlat: update failed", { error: failed.error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function importSitemapPages(
  sitemapId: string,
  pages: { path: string; title: string; kind?: string }[],
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  if (pages.length === 0) {
    return { ok: true, created: 0, skipped: 0 };
  }

  const ctx = await guardedAdmin();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const sitemap = await resolveSitemapWorkspace(ctx.admin, sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return { ok: false, error: access.error };

  const { data: existingPages, error: existingError } = await ctx.admin
    .from("sitemap_pages")
    .select("slug")
    .eq("sitemap_id", sitemap.id);

  if (existingError) {
    logger.error("importSitemapPages: failed to load existing pages", { error: existingError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const existingSlugs = new Set((existingPages ?? []).map((p) => p.slug));
  let position = existingSlugs.size;
  let created = 0;
  let skipped = 0;
  const rowsToInsert: { sitemap_id: string; title: string; slug: string; kind: string; position: number }[] = [];

  for (const page of pages) {
    const slugCheck = sitemapPageSlugSchema.safeParse(page.path);
    const titleCheck = sitemapPageTitleSchema.safeParse(page.title);
    const kindCheck = sitemapPageKindEnum.safeParse(page.kind ?? "static");

    if (!slugCheck.success || !titleCheck.success || existingSlugs.has(slugCheck.data)) {
      skipped += 1;
      continue;
    }

    existingSlugs.add(slugCheck.data);
    rowsToInsert.push({
      sitemap_id: sitemap.id,
      title: titleCheck.data,
      slug: slugCheck.data,
      kind: kindCheck.success ? kindCheck.data : "static",
      position: position++,
    });
    created += 1;
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await ctx.admin.from("sitemap_pages").insert(rowsToInsert);
    if (insertError) {
      logger.error("importSitemapPages: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }
  }

  revalidateSitemaps();
  return { ok: true, created, skipped };
}

// ---------------------------------------------------------------------
// Component <-> section linking (Phase 2: `componentLinks` capability
// group for ArchitectureActionsProvider, lib/architecture/actions-context.tsx).
// Signatures/return shapes intentionally MIRROR
// lib/actions/architecture/components.ts's own (MutationResult /
// MutationWithIdResult / MutationWithComponentIdResult, `success`/`error`
// not `ok`/`data`) since that is the exact shape
// ArchitectureComponentLinkActions requires -- this repo's other
// sitemap actions above use `ActionResult` (`ok`/`data`) because they're
// standalone Phase 1 CRUD with no existing shape to match; these four are
// the board UI's own capability contract and have no freedom to differ.
// ---------------------------------------------------------------------

type MutationResult = { success: boolean; error?: string };
type MutationWithComponentIdResult = MutationResult & { componentId?: string };

export async function createSitemapComponentFromSection(
  sectionId: string,
  sitemapId: string,
): Promise<MutationWithComponentIdResult> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  // The caller-supplied sitemapId is only a consistency check: the
  // component is always created in the section's OWN sitemap, which is the
  // one write access was verified against.
  if (!section || section.sitemapId !== sitemapId) {
    return { success: false, error: "Section not found." };
  }

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { data: sectionRow, error: sectionError } = await ctx.admin
    .from("sitemap_sections")
    .select("id, title, component_id")
    .eq("id", section.sectionId)
    .maybeSingle();

  if (sectionError || !sectionRow) {
    return { success: false, error: "Section not found." };
  }

  if (sectionRow.component_id) {
    return { success: false, error: "Section already linked to a component" };
  }

  const nameCheck = sitemapComponentNameSchema.safeParse(sectionRow.title);
  if (!nameCheck.success) {
    return { success: false, error: "Section title cannot become a component name." };
  }

  const { count: existingCount, error: countError } = await ctx.admin
    .from("sitemap_components")
    .select("id", { count: "exact", head: true })
    .eq("sitemap_id", section.sitemapId);

  if (countError) {
    logger.error("createSitemapComponentFromSection: count failed", { error: countError });
    return { success: false, error: GENERIC_ERROR };
  }

  const { data: insertedComponent, error: insertError } = await ctx.admin
    .from("sitemap_components")
    .insert({ sitemap_id: section.sitemapId, name: nameCheck.data, position: existingCount ?? 0 })
    .select("id")
    .single();

  if (insertError || !insertedComponent) {
    if (insertError?.code === "23505") {
      return { success: false, error: "A component with this name already exists." };
    }
    logger.error("createSitemapComponentFromSection: insert failed", { error: insertError });
    return { success: false, error: GENERIC_ERROR };
  }

  const { error: linkError } = await ctx.admin
    .from("sitemap_sections")
    .update({ component_id: insertedComponent.id })
    .eq("id", section.sectionId);

  if (linkError) {
    logger.error("createSitemapComponentFromSection: link failed", { error: linkError });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true, componentId: insertedComponent.id };
}

export async function linkSitemapComponentToSection(
  sectionId: string,
  componentId: string,
): Promise<MutationResult> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  if (!section) return { success: false, error: "Section not found." };

  // The component must live in the section's own sitemap -- never another
  // sitemap's (or another workspace's) component id.
  const component = await resolveComponentSitemapWorkspace(ctx.admin, componentId);
  if (!component || component.sitemapId !== section.sitemapId) {
    return { success: false, error: "Component not found." };
  }

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { error } = await ctx.admin
    .from("sitemap_sections")
    .update({ component_id: component.componentId })
    .eq("id", section.sectionId);

  if (error) {
    logger.error("linkSitemapComponentToSection: update failed", { error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function unlinkSitemapComponentFromSection(
  sectionId: string,
): Promise<MutationResult> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const section = await resolveSectionPageSitemapWorkspace(ctx.admin, sectionId);
  if (!section) return { success: false, error: "Section not found." };

  const access = await requireWriteAccess(ctx.admin, section.workspaceId, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { error } = await ctx.admin
    .from("sitemap_sections")
    .update({ component_id: null })
    .eq("id", section.sectionId);

  if (error) {
    logger.error("unlinkSitemapComponentFromSection: update failed", { error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function reorderSitemapComponents(
  sitemapId: string,
  componentIds: string[],
): Promise<MutationResult> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return { success: false, error: ctx.error };

  const sitemap = await resolveSitemapWorkspace(ctx.admin, sitemapId);
  if (!sitemap) return { success: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return { success: false, error: access.error };

  const { data: components, error: componentsError } = await ctx.admin
    .from("sitemap_components")
    .select("id")
    .eq("sitemap_id", sitemap.id);

  if (componentsError) {
    logger.error("reorderSitemapComponents: failed to load components", { error: componentsError });
    return { success: false, error: GENERIC_ERROR };
  }

  const validIds = new Set((components ?? []).map((c) => c.id));
  if (!Array.isArray(componentIds) || componentIds.some((id) => !validIds.has(id))) {
    return { success: false, error: "One or more components do not belong to this sitemap." };
  }

  const updates = await Promise.all(
    componentIds.map((id, index) =>
      ctx.admin.from("sitemap_components").update({ position: index }).eq("id", id),
    ),
  );

  const failed = updates.find((result) => result.error);
  if (failed?.error) {
    logger.error("reorderSitemapComponents: update failed", { error: failed.error });
    return { success: false, error: GENERIC_ERROR };
  }

  revalidateSitemaps();
  return { success: true };
}

export async function revokeSitemapShare(
  sitemapId: string,
  token: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await guardedAdmin();
  if (!ctx.ok) return ctx;

  const sitemap = await resolveSitemapWorkspace(ctx.admin, sitemapId);
  if (!sitemap) return { ok: false, error: "Sitemap not found." };

  const access = await requireWriteAccess(ctx.admin, sitemap.workspace_id, ctx.userId);
  if (!access.ok) return access;

  const { data, error } = await ctx.admin
    .from("sitemap_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("sitemap_id", sitemap.id)
    .eq("token", token)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("revokeSitemapShare: update failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }

  if (!data) {
    return { ok: false, error: "Share link not found or already revoked." };
  }

  revalidateSitemaps();
  return { ok: true, data: { id: data.id } };
}
