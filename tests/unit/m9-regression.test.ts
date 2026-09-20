import { readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import { describe, it, expect } from "vitest"

// SHA-256 of the normalized concatenation of resolveClientBucket AND every
// declaration it depends on (ClientBucket-bucket set / isClientBucket guard /
// CATEGORY_BUCKET_FALLBACK table). Widened from just the function body so a
// mutation to the fallback table or the bucket guard -- not just to
// resolveClientBucket's own lines -- is caught here too.
// CLAUDE.md: "must never be changed."
// To update this hash: extract the spans below, normalize them, recompute.
const EXPECTED_HASH =
  "0741b8a852531f6d9855a2e808ec4c36935136206bb3162701ba6a04536fb499"

function extractFunctionSpan(source: string, startIndex: number): string {
  const braceStart = source.indexOf("{", startIndex)
  let depth = 0
  let i = braceStart
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++
    else if (source[i] === "}") {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(startIndex, i + 1)
}

function normalizeFunctionBody(fnBody: string): string {
  return fnBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

describe("M9 regression (AS-178, AS-179, AS-180, AS-181)", () => {
  it("AS-178: resolveClientBucket (and its dependencies) is byte-identical to the locked implementation", () => {
    const content = readFileSync(join(process.cwd(), "components/portal/status-label.ts"), "utf8")

    const spans: string[] = []

    // CLIENT_BUCKETS set
    let idx = content.indexOf("const CLIENT_BUCKETS")
    expect(idx, "CLIENT_BUCKETS not found").not.toBe(-1)
    let semiIdx = content.indexOf(";", content.indexOf("]", idx))
    spans.push(content.slice(idx, semiIdx + 1))

    // isClientBucket function
    idx = content.indexOf("function isClientBucket")
    expect(idx, "isClientBucket not found").not.toBe(-1)
    spans.push(extractFunctionSpan(content, idx))

    // CATEGORY_BUCKET_FALLBACK table
    idx = content.indexOf("const CATEGORY_BUCKET_FALLBACK")
    expect(idx, "CATEGORY_BUCKET_FALLBACK not found").not.toBe(-1)
    semiIdx = content.indexOf(";", content.indexOf("}", idx))
    spans.push(content.slice(idx, semiIdx + 1))

    // resolveClientBucket function itself
    let startIndex = content.indexOf("export function resolveClientBucket")
    if (startIndex === -1) {
      startIndex = content.indexOf("export const resolveClientBucket")
    }
    expect(startIndex).not.toBe(-1)
    spans.push(extractFunctionSpan(content, startIndex))

    const normalized = spans.map(normalizeFunctionBody).join(" || ")
    const hash = createHash("sha256").update(normalized).digest("hex")

    expect(hash).toBe(EXPECTED_HASH)
  })

  it("AS-178b: resolveClientBucket pinned behaviour table", async () => {
    const mod = await import("../../components/portal/status-label")
    const { resolveClientBucket } = mod

    // category x storedBucket x pendingClientApproval truth table.
    // Encodes the doc-comment invariants in status-label.ts:
    //  - pendingClientApproval wins over storedBucket/category, EXCEPT when
    //    category is "done" (delivered work is never "waiting").
    //  - a valid storedBucket wins over the category fallback.
    //  - an invalid/null/undefined storedBucket falls back to
    //    CATEGORY_BUCKET_FALLBACK[category].
    //  - not_started and in_progress both fall back to "progress"; done
    //    falls back to "done".
    const cases: Array<{
      category: "not_started" | "in_progress" | "done"
      storedBucket: string | null | undefined
      pendingClientApproval?: boolean
      expected: "waiting" | "progress" | "blocked" | "done"
      label: string
    }> = [
      // No stored bucket, no pending approval: category fallback.
      { category: "not_started", storedBucket: null, expected: "progress", label: "not_started/null/false -> progress" },
      { category: "in_progress", storedBucket: null, expected: "progress", label: "in_progress/null/false -> progress" },
      { category: "done", storedBucket: null, expected: "done", label: "done/null/false -> done" },
      { category: "not_started", storedBucket: undefined, expected: "progress", label: "not_started/undefined/false -> progress" },

      // Invalid stored bucket string: falls through to category fallback.
      { category: "not_started", storedBucket: "not-a-real-bucket", expected: "progress", label: "not_started/invalid/false -> progress" },
      { category: "done", storedBucket: "bogus", expected: "done", label: "done/invalid/false -> done" },

      // Valid stored bucket overrides category fallback.
      { category: "not_started", storedBucket: "blocked", expected: "blocked", label: "not_started/blocked/false -> blocked" },
      { category: "in_progress", storedBucket: "waiting", expected: "waiting", label: "in_progress/waiting/false -> waiting" },
      { category: "done", storedBucket: "waiting", expected: "waiting", label: "done/waiting/false (no pending) -> waiting" },
      { category: "not_started", storedBucket: "done", expected: "done", label: "not_started/done/false -> done" },

      // pendingClientApproval true wins over everything except category === done.
      { category: "not_started", storedBucket: null, pendingClientApproval: true, expected: "waiting", label: "not_started/null/true -> waiting" },
      { category: "in_progress", storedBucket: "blocked", pendingClientApproval: true, expected: "waiting", label: "in_progress/blocked/true -> waiting (pending wins)" },
      { category: "not_started", storedBucket: "done", pendingClientApproval: true, expected: "waiting", label: "not_started/done-bucket/true -> waiting (pending wins over stored bucket)" },

      // pendingClientApproval true but category === done: pending is ignored.
      { category: "done", storedBucket: null, pendingClientApproval: true, expected: "done", label: "done/null/true -> done (pending ignored for done category)" },
      { category: "done", storedBucket: "blocked", pendingClientApproval: true, expected: "blocked", label: "done/blocked/true -> blocked (pending ignored, stored bucket used)" },

      // pendingClientApproval explicitly false behaves like default (unset).
      { category: "in_progress", storedBucket: null, pendingClientApproval: false, expected: "progress", label: "in_progress/null/explicit-false -> progress" },
    ]

    for (const c of cases) {
      const result = resolveClientBucket(
        c.category,
        c.storedBucket,
        c.pendingClientApproval,
      )
      expect(result, c.label).toBe(c.expected)
    }

    // Default parameter: omitting pendingClientApproval behaves as false.
    expect(resolveClientBucket("not_started", null)).toBe("progress")
  })

  it("AS-179: resolveClientBucket stays reachable (exported) and components/portal is not excluded from typechecking", () => {
    const content = readFileSync(join(process.cwd(), "components/portal/status-label.ts"), "utf8")
    expect(content).toMatch(/export\s+(function|const)\s+resolveClientBucket/)

    const tsconfig = readFileSync(join(process.cwd(), "tsconfig.json"), "utf8")
    const parsed = JSON.parse(tsconfig)
    const excludes: string[] = Array.isArray(parsed.exclude) ? parsed.exclude : []
    const excludesPortal = excludes.some((entry) =>
      entry.includes("components/portal")
    )
    expect(excludesPortal, "components/portal must not be excluded from tsconfig").toBe(false)
  })

  it("AS-180: architecture query selects the live task columns and excludes dropped page_components.description", () => {
    const content = readFileSync(join(process.cwd(), "lib/queries/architecture.ts"), "utf8")

    // Extract the task/board column constant.
    const taskColumnsMatch = content.match(/const TASK_COLUMNS\s*=\s*\n?\s*"([^"]+)"/)
    expect(taskColumnsMatch, "TASK_COLUMNS constant not found").toBeTruthy()
    const taskColumns = taskColumnsMatch![1]
    // Positive assertion: the live, current columns are present.
    expect(taskColumns).toContain("page_kind")
    expect(taskColumns).toContain("page_slug")

    // Extract the page_components column constant.
    const componentColumnsMatch = content.match(/const COMPONENT_COLUMNS\s*=\s*"([^"]+)"/)
    expect(componentColumnsMatch, "COMPONENT_COLUMNS constant not found").toBeTruthy()
    const componentColumns = componentColumnsMatch![1]
    // Negative assertion: the dropped page_components.description column is absent.
    expect(componentColumns).not.toContain("description")
    // Positive assertion: the critical board-rendering columns are present.
    expect(componentColumns).toContain("name")
    expect(componentColumns).toContain("position")

    // node_meta (architecture_node_meta).client_visible was dropped -- this
    // file never references node_meta at all, so its own client_visible
    // usages (page_components.client_visible / sections.client_visible,
    // both live columns) are a different, non-dropped column and are
    // intentionally not asserted against here. See m9-migration-check.test.ts
    // (AS-173) for the actual "column absent from generated types" check.
    expect(content).not.toMatch(/node_meta/i)
  })

  it("AS-181: setNodeMetaClientVisibility removed tree-wide, not just from the barrel", () => {
    // Sub-assertion: the barrel no longer exports/references it.
    const barrel = readFileSync(join(process.cwd(), "lib/actions/architecture.ts"), "utf8")
    expect(barrel).not.toContain("setNodeMetaClientVisibility")

    // Full tree scan: no app/component/lib source file should reference it
    // (excluding tests, specs, and mission/handoff docs).
    let grepOutput = ""
    try {
      grepOutput = execSync(
        'grep -r "setNodeMetaClientVisibility" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l 2>/dev/null || true',
        { cwd: process.cwd(), encoding: "utf8" }
      )
    } catch {
      grepOutput = ""
    }

    const matches = grepOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (path) =>
          !path.includes(".test.") &&
          !path.includes(".spec.") &&
          !path.includes("missions/") &&
          !path.includes("handoffs/") &&
          !path.includes("__tests__/")
      )

    expect(matches).toEqual([])

    // Dropped-column guard: architecture_node_meta.client_visible was
    // dropped. client_visible remains a live column on page_components and
    // sections, so a bare grep for "client_visible" is not sufficient --
    // only flag files that also reference architecture_node_meta.
    const nodeMetaClientVisibleUses = execSync(
      'grep -r "client_visible" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l 2>/dev/null || true',
      { cwd: process.cwd(), encoding: "utf8" }
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (path) =>
          !path.includes(".test.") &&
          !path.includes(".spec.") &&
          !path.includes("missions/") &&
          !path.includes("handoffs/") &&
          !path.includes("__tests__/") &&
          !path.includes("database.types.ts")
      )

    const qualifiedRefs = nodeMetaClientVisibleUses.filter((f) => {
      const content = readFileSync(join(process.cwd(), f), "utf8")
      return content.includes("architecture_node_meta") && content.includes("client_visible")
    })

    expect(
      qualifiedRefs,
      `Files reference dropped column architecture_node_meta.client_visible: ${qualifiedRefs.join(", ")}`
    ).toHaveLength(0)
  })
})
