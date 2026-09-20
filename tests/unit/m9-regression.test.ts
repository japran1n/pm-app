import { readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import { describe, it, expect } from "vitest"

// SHA-256 of normalized resolveClientBucket body.
// CLAUDE.md: "must never be changed."
// To update this hash: extract the function, normalize it, recompute.
const EXPECTED_HASH =
  "54989a5a8988db59d27e52761eb7e2f913989e5e8ab452181c47192d2ec09167"

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
  it("AS-178: resolveClientBucket is byte-identical to the locked implementation", () => {
    const content = readFileSync(join(process.cwd(), "components/portal/status-label.ts"), "utf8")

    let startIndex = content.indexOf("export function resolveClientBucket")
    if (startIndex === -1) {
      startIndex = content.indexOf("export const resolveClientBucket")
    }
    expect(startIndex).not.toBe(-1)

    const fnBody = extractFunctionSpan(content, startIndex)
    const normalized = normalizeFunctionBody(fnBody)
    const hash = createHash("sha256").update(normalized).digest("hex")

    expect(hash).toBe(EXPECTED_HASH)
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
  })
})
