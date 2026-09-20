import { readFileSync } from "fs"
import { join } from "path"
import { describe, it, expect } from "vitest"

describe("M9 database types check (AS-172, AS-173)", () => {
  const typesContent = readFileSync(
    join(process.cwd(), "lib/supabase/database.types.ts"),
    "utf8",
  )

  it("AS-172: page_components.description is not in the types file", () => {
    // Isolate the page_components table block (from its declaration to the closing brace
    // at the same indentation, i.e. before the next sibling table key).
    const match = typesContent.match(
      /page_components: \{[\s\S]*?\n {6}\}\n {6}\w/,
    )
    expect(match).not.toBeNull()
    const pcSection = match?.[0] ?? ""
    expect(pcSection).not.toContain("description")
  })

  it("AS-173: node_meta (architecture_node_meta).client_visible is not in the types file", () => {
    const match = typesContent.match(
      /architecture_node_meta: \{[\s\S]*?\n {6}\}\n {6}\w/,
    )
    expect(match).not.toBeNull()
    const nmSection = match?.[0] ?? ""
    expect(nmSection).not.toContain("client_visible")
  })
})
