import { readFileSync } from "fs"
import { join } from "path"
import { describe, it, expect } from "vitest"

describe("M9 regression (AS-178, AS-179, AS-180, AS-181)", () => {
  it("AS-178: resolveClientBucket exists in status-label.ts", () => {
    const content = readFileSync(join(process.cwd(), "components/portal/status-label.ts"), "utf8")
    expect(content).toContain("resolveClientBucket")
  })

  it("AS-180: architecture query does not reference dropped columns", () => {
    const content = readFileSync(join(process.cwd(), "lib/queries/architecture.ts"), "utf8")
    // page_components.description was dropped
    expect(content).not.toMatch(/\.description\b.*page_component/i)
    // node_meta (architecture_node_meta).client_visible was dropped -- this
    // file never references node_meta at all, so its own client_visible
    // usages (page_components.client_visible / sections.client_visible,
    // both live columns) are a different, non-dropped column and are
    // intentionally not asserted against here. See m9-migration-check.test.ts
    // (AS-173) for the actual "column absent from generated types" check.
    expect(content).not.toMatch(/node_meta/i)
  })

  it("AS-181: setNodeMetaClientVisibility not in barrel", () => {
    const barrel = readFileSync(join(process.cwd(), "lib/actions/architecture.ts"), "utf8")
    expect(barrel).not.toContain("setNodeMetaClientVisibility")
  })
})
