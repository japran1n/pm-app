"use client";

// F015: renders the unified line diff already computed and stored on a
// proposal (lib/ai/tools/propose-doc-edit.ts's `DocEditDiffLine[]`, via
// the `diff` package's `diffLines`). Plain styled text, NOT a browser diff
// library — the diff itself was already computed server-side (F014); this
// component's only job is to lay out lines that are already classified.
//
// `DocEditDiffLine.value` can be a multi-line chunk (`diffLines` groups
// consecutive same-type lines together, per F014's own handoff note to
// this feature) — split on "\n" here so every rendered row is exactly one
// source line, matching a real unified-diff's one-row-per-line shape.

import type { DocEditDiffLine } from "@/lib/ai/tools/propose-doc-edit";

/** One rendered row: a diff line type plus its single line of text. */
type DiffRow = { type: DocEditDiffLine["type"]; text: string };

/**
 * Expands `DocEditDiffLine[]` (which may group multiple source lines into
 * one `value` chunk) into one `DiffRow` per source line. A trailing empty
 * string produced by splitting a chunk that itself ends in "\n" is
 * dropped — it is an artifact of the split, not a real blank line the
 * diff intended to show (a genuine blank line inside a chunk still
 * produces an empty-string row from an interior split, which IS kept).
 */
function expandDiffLines(diff: DocEditDiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const line of diff) {
    const parts = line.value.split("\n");
    // `diffLines` chunks always end their `value` in "\n" except possibly
    // the very last chunk in the whole diff (no trailing newline in the
    // source document) — split() on a trailing "\n" produces one trailing
    // "" element that is not a real line.
    if (parts.length > 0 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    for (const text of parts) {
      rows.push({ type: line.type, text });
    }
  }
  return rows;
}

/** Compact counts for a collapsed card: "4 lines added, 1 removed". */
export function countDiffLines(diff: DocEditDiffLine[]): { added: number; removed: number } {
  const rows = expandDiffLines(diff);
  return {
    added: rows.filter((row) => row.type === "added").length,
    removed: rows.filter((row) => row.type === "removed").length,
  };
}

const ROW_STYLES: Record<DocEditDiffLine["type"], string> = {
  // AS-069: colour is never the only signal — the leading "+"/"-"/" "
  // marker carries the meaning independently of the background tint.
  added: "bg-status-done-bg text-foreground",
  removed: "bg-status-blocked-bg text-foreground",
  context: "text-muted-foreground",
};

const ROW_MARKERS: Record<DocEditDiffLine["type"], string> = {
  added: "+",
  removed: "-",
  context: " ",
};

export function DiffView({ diff }: { diff: DocEditDiffLine[] }) {
  const rows = expandDiffLines(diff);

  return (
    <div
      data-testid="diff-view"
      role="group"
      aria-label="Proposed change diff"
      className="max-h-64 overflow-y-auto rounded-md border border-border font-mono text-micro"
    >
      {rows.map((row, index) => (
        <div
          key={index}
          data-testid={`diff-row-${row.type}`}
          className={`flex gap-2 px-2 py-0.5 whitespace-pre-wrap break-words ${ROW_STYLES[row.type]}`}
        >
          <span aria-hidden="true" className="w-3 shrink-0 select-none font-semibold">
            {ROW_MARKERS[row.type]}
          </span>
          <span className="min-w-0 flex-1">{row.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

export default DiffView;
