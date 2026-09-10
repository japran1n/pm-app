import { cn } from "@/lib/utils";
import type { BoardPageKind } from "@/lib/queries/architecture";

// Mission 20260910-182104, F007 (AS-022, AS-023): a small badge on each page
// column showing whether the page is static, CMS-driven, or a utility page.
// The CMS variant is visually distinct from static/utility via the
// --cms-* design tokens (lilac); static/utility stay neutral/muted.
const LABELS: Record<BoardPageKind, string> = {
  static: "Static",
  cms: "CMS",
  utility: "Utility",
};

export function PageKindBadge({ kind }: { kind: BoardPageKind | null }) {
  const resolved = kind ?? "static";
  const isCms = resolved === "cms";

  return (
    <span
      data-page-kind={resolved}
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center rounded-full border px-[5.5px] py-[3px] text-[9px] font-medium tracking-[0.07em] whitespace-nowrap uppercase",
        isCms
          ? "border-[var(--cms-border)] bg-[var(--cms)]/10 text-[var(--cms-foreground)]"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {LABELS[resolved]}
    </span>
  );
}
