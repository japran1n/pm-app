"use client";

// Export the sitemap to a classic interchange format, or import one.
//
// Export runs entirely client-side -- the serialisers in
// lib/architecture/sitemap-io.ts are pure, so there is nothing to round
// trip through the server just to build a string the user then downloads.
// Import does go through a Server Action (importPages) because it writes.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";

import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";
import {
  toSitemapXml,
  toCsv,
  toMarkdown,
  toJson,
  parseSitemap,
} from "@/lib/architecture/sitemap-io";
import { toCopyBriefMarkdown, toCopyBriefJson } from "@/lib/architecture/copy-brief";
import { useArchitectureActions } from "@/lib/architecture/actions-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Format = "xml" | "csv" | "md" | "json" | "brief-md" | "brief-json";

const FORMATS: {
  value: Format;
  label: string;
  extension: string;
  mime: string;
  exportOnly?: boolean;
}[] = [
  { value: "xml", label: "Sitemap XML", extension: "xml", mime: "application/xml" },
  { value: "csv", label: "CSV", extension: "csv", mime: "text/csv" },
  { value: "md", label: "Markdown", extension: "md", mime: "text/markdown" },
  { value: "json", label: "JSON", extension: "json", mime: "application/json" },
  {
    value: "brief-md",
    label: "Copy brief (Markdown)",
    extension: "md",
    mime: "text/markdown",
    exportOnly: true,
  },
  {
    value: "brief-json",
    label: "Copy brief (JSON)",
    extension: "json",
    mime: "application/json",
    exportOnly: true,
  },
];

export function SitemapIoDialog({
  pages,
  projectId,
  projectName,
  detailsData,
  open,
  onOpenChange,
}: {
  pages: BoardPage[];
  projectId: string;
  projectName: string;
  detailsData?: ArchitectureNodeDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { importPages, readOnly } = useArchitectureActions();
  const router = useRouter();
  const [format, setFormat] = useState<Format>("xml");
  const [baseUrl, setBaseUrl] = useState("https://example.com");
  const [importText, setImportText] = useState("");
  const [isImporting, startImport] = useTransition();
  const [briefPageSlug, setBriefPageSlug] = useState<string>("__all__");

  const isBriefFormat = format === "brief-md" || format === "brief-json";
  const briefOpts =
    isBriefFormat && briefPageSlug !== "__all__" ? { pageSlug: briefPageSlug } : undefined;

  function serialise(): string {
    switch (format) {
      case "xml":
        return toSitemapXml(pages, baseUrl);
      case "csv":
        return toCsv(pages);
      case "md":
        return toMarkdown(pages, detailsData ?? null);
      case "json":
        return toJson(pages);
      case "brief-md":
        return toCopyBriefMarkdown(pages, detailsData ?? new Map(), briefOpts);
      case "brief-json":
        return toCopyBriefJson(pages, detailsData ?? new Map(), briefOpts);
    }
  }

  function handleDownload() {
    const spec = FORMATS.find((entry) => entry.value === format);
    if (!spec) return;
    const blob = new Blob([serialise()], { type: `${spec.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const slug = (projectName || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const isBrief = format === "brief-md" || format === "brief-json";
    const pageSuffix =
      isBrief && briefPageSlug !== "__all__"
        ? `-${briefPageSlug.replace(/^\//, "").replace(/\//g, "-") || "home"}`
        : "";
    const suffix = isBrief ? "copy-brief" : "sitemap";
    anchor.download = `${slug}-${suffix}${pageSuffix}.${spec.extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(serialise());
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Couldn't copy. Use Download instead.");
    }
  }

  function handleFile(file: File) {
    file.text().then(setImportText);
  }

  function handleImport() {
    if (readOnly) return;
    const parsed = parseSitemap(importText);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }

    startImport(async () => {
      const result = await importPages(projectId, parsed.pages);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.skipped > 0
          ? `Imported ${result.created} pages, skipped ${result.skipped} already present.`
          : `Imported ${result.created} pages.`,
      );
      setImportText("");
      onOpenChange(false);
      router.refresh();
    });
  }

  const preview = open ? serialise() : "";
  const parsedCount = importText.trim() === "" ? null : parseSitemap(importText);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sitemap</DialogTitle>
          <DialogDescription>
            Export this architecture to a standard format, or import an existing sitemap.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="export">
          <TabsList>
            <TabsTrigger value="export">Export</TabsTrigger>
            {!readOnly && <TabsTrigger value="import">Import</TabsTrigger>}
          </TabsList>

          <TabsContent value="export" className="flex flex-col gap-3 pt-3">
            <div className="flex flex-wrap gap-1">
              {FORMATS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setFormat(entry.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    format === entry.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border-control-hover"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {format === "xml" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sitemap-base-url">Base URL</Label>
                <Input
                  id="sitemap-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://example.com"
                />
              </div>
            )}

            {isBriefFormat && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="brief-page-scope">Page</Label>
                <select
                  id="brief-page-scope"
                  value={briefPageSlug}
                  onChange={(event) => setBriefPageSlug(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus-visible:border-border-control-hover"
                >
                  <option value="__all__">All pages</option>
                  {pages.map((page) => (
                    <option key={page.id} value={page.pageSlug}>
                      {page.title} ({page.pageSlug})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
              {preview}
            </pre>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={handleCopy}>
                Copy
              </Button>
              <Button type="button" onClick={handleDownload}>
                <Download className="size-4" aria-hidden />
                Download
              </Button>
            </div>
          </TabsContent>

          {!readOnly && (
          <TabsContent value="import" className="flex flex-col gap-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Accepts a sitemap.xml, a JSON export from here, or a plain list of paths —
              one per line, or an indented bullet outline.
            </p>

            <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-border-control-hover hover:text-foreground">
              <Upload className="size-3.5" aria-hidden />
              Choose file
              <input
                type="file"
                accept=".xml,.json,.txt,.md,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>

            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={"/\n/about\n/services\n/services/seo"}
              className="w-full rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed outline-none focus-visible:border-border-control-hover"
            />

            {parsedCount !== null && (
              <p
                className={`text-xs ${parsedCount.ok ? "text-muted-foreground" : "text-destructive"}`}
                role={parsedCount.ok ? undefined : "alert"}
              >
                {parsedCount.ok
                  ? `${parsedCount.pages.length} pages detected (ancestors filled in automatically).`
                  : parsedCount.error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                disabled={isImporting || parsedCount === null || !parsedCount.ok}
                onClick={handleImport}
              >
                {isImporting ? "Importing..." : "Import pages"}
              </Button>
            </div>
          </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
