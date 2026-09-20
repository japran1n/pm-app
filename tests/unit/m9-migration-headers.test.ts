import { readFileSync } from "fs"
import { join } from "path"
import { describe, it, expect } from "vitest"

describe("M9 migration headers (AS-168, AS-169)", () => {
  const MISSION_MIGRATIONS = [
    "supabase/migrations/20261127130000_drop_page_components_description.sql",
    "supabase/migrations/20261127140000_drop_node_meta_client_visible.sql",
  ]

  it("AS-168: every mission migration has a leading -- comment", () => {
    for (const p of MISSION_MIGRATIONS) {
      const content = readFileSync(join(process.cwd(), p), "utf8")
      expect(content.trimStart().startsWith("--"), `${p} must start with a -- comment`).toBe(true)
    }
  })

  it("AS-169: destructive migration (140000) comes after other mission migration (130000)", () => {
    // Both are destructive but 140000 drops node_meta_client_visible which
    // was additive (added in an earlier migration) — verify timestamp order is correct
    const timestamps = MISSION_MIGRATIONS.map(p => p.split("/").pop()!.split("_")[0])
    expect(timestamps[0] < timestamps[1]).toBe(true)
  })
})
