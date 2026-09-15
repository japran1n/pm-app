"use client";

// 20260915-status-sitemap-audit, F2 (AS-7): the portal's read-only
// nested/tree view of the page hierarchy -- the single biggest gap the
// audit found (audit-sitemap.md, gap table): the team's own board default
// is the nested canvas (canvas-board.tsx), while clients only ever saw the
// flatter column list, i.e. the weaker of the two views the team itself
// prefers.
//
// Hierarchy comes from `lib/architecture/page-tree.ts`'s `buildPageTree`,
// the exact same function `canvas-board.tsx` uses -- reused rather than
// reimplemented so "what counts as a folder" never has two answers. This
// view deliberately does NOT reuse `canvas-board.tsx`'s @xyflow/react
// pan/zoom rendering: that library's node measurement only resolves once
// mounted in a real browser layout, and canvas-board.tsx itself has no
// test coverage in this codebase for exactly that reason (nothing under
// tests/ renders it). A plain recursive/indented DOM tree renders the same
// hierarchy, is read-only by construction (nothing here is `nodrag`,
// draggable, or wired to a mutation), and is fully exercisable by RTL --
// see tests/unit/f2-as7-client-sitemap-tree.test.tsx. AS-7 only requires
// "a read-only nested/tree (or canvas) view... reflecting the real page
// hierarchy", which this satisfies without pulling xyflow into a route
// that never needs to place, drag, or resize a node.
//
// Every editing affordance from canvas-board.tsx's SitemapNode is gone:
// no "Create page here" on folders, no add-child/collapse controls, no
// PageKindSelector, no DeletePageButton, no AddSectionButton -- a client
// can look, not touch.
//
// Leak check (see audit-sitemap.md D + this feature's clarified scope):
// `buildPageTree` is only ever given `pages`, which by the time this
// component renders is already the client-visible, non-deleted subset
// `getArchitectureBoardForClient` returns. A folder node is synthesised
// purely from a VISIBLE page's own slug path segments (page-tree.ts reads
// only `pages[].pageSlug` / `.title` for entries present in the array),
// so a page the client cannot see never contributes a segment, a title,
// or a description here -- there is no code path back to the unfiltered
// project-wide page set. The one theoretical residue is that a shared
// page's slug segment name (e.g. "services") is itself derived from the
// page's own slug, which the client already legitimately sees on that
// very page -- not from a hidden sibling. Considered and not treated as
// exploitable, but flagged explicitly per this feature's own instructions
// rather than left as a silent assumption.
import { useMemo } from "react";
import { FolderClosed } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BoardPage } from "@/lib/queries/architecture";
import { buildPageTree, type PageTreeNode } from "@/lib/architecture/page-tree";
import { PageKindBadge } from "@/components/architecture/page-kind-badge";
import { sectionKindStaticTintClassName } from "@/lib/architecture/section-tint";
import { useComponentHover } from "@/lib/architecture/use-component-hover";

function nodeAccent(node: PageTreeNode): "folder" | "cms" | "" {
  if (node.page === null) return "folder";
  const kind = node.page.pageKind;
  return kind === "cms" || kind === "cms_template" ? "cms" : "";
}

function TreeNodeCard({ node }: { node: PageTreeNode }) {
  const page = node.page;
  const isFolder = page === null;
  const accent = nodeAccent(node);

  return (
    <div
      data-testid={isFolder ? `sitemap-folder-${node.key}` : `sitemap-page-${page.id}`}
      data-page-id={isFolder ? undefined : page.id}
      className={cn(
        "w-64 shrink-0 rounded-lg border bg-card shadow-xs transition-colors",
        accent === "folder" && "border-dashed border-folder-border bg-folder/5",
        accent === "cms" && "border-cms-border bg-cms/5",
        accent === "" && "border-border",
      )}
    >
      {isFolder ? (
        <div className="flex items-center gap-1.5 px-3 py-2.5">
          <FolderClosed className="size-3.5 shrink-0 text-folder-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-folder-foreground">
            {node.label}
          </span>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "flex items-center gap-2 border-b px-3 py-2",
              accent === "cms" ? "border-cms-border" : "border-border",
            )}
          >
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{page.title}</p>
            <PageKindBadge kind={page.pageKind} />
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {page.sections.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">No sections yet.</p>
            ) : (
              page.sections.map((section) => (
                <div
                  key={section.id}
                  data-testid={`sitemap-section-${section.id}`}
                  data-component={section.component?.id ?? undefined}
                  data-section-kind={section.kind}
                  className={cn(
                    "w-full rounded-md border bg-card px-2 py-1.5 text-xs shadow-xs transition-colors",
                    sectionKindStaticTintClassName(section),
                  )}
                >
                  <p className="truncate font-medium">{section.title}</p>
                  {section.component ? (
                    <p className="truncate text-muted-foreground">{section.component.name}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TreeBranch({ node }: { node: PageTreeNode }) {
  return (
    <li className="flex flex-col items-start gap-3">
      <TreeNodeCard node={node} />
      {node.children.length > 0 ? (
        <ul className="ml-4 flex flex-col gap-3 border-l border-dashed border-border pl-4">
          {node.children.map((child) => (
            <TreeBranch key={child.key} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ClientSitemapTree({ pages }: { pages: BoardPage[] }) {
  const root = useMemo(() => buildPageTree(pages), [pages]);
  // Same CSS-only hover-linking as the column view (AS-10) -- this is a
  // plain DOM tree, not an @xyflow/react canvas, so the hook's
  // `[data-component]` selector works exactly the same way it does on
  // `client-board.tsx`, no extra wiring needed.
  const hoverRef = useComponentHover<HTMLDivElement>();

  return (
    <div
      ref={hoverRef}
      data-testid="client-sitemap-tree"
      className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background p-4"
    >
      <ul className="flex flex-col gap-3">
        <TreeBranch node={root} />
      </ul>
    </div>
  );
}
