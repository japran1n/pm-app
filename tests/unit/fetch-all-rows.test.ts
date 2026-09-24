// DB-ACCESS-04: paging past PostgREST's max_rows cap.
import { describe, expect, it, vi } from "vitest";

import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + 1000)),
    error: null,
  }));
}

describe("fetchAllRows", () => {
  it("returns every row beyond the 1000-row cap", async () => {
    const page = table(2503);
    const { data, error } = await fetchAllRows(page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2503);
    expect(page).toHaveBeenCalledTimes(3);
    expect(page).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("stops after an exact multiple with one empty page", async () => {
    const page = table(2000);
    expect((await fetchAllRows(page)).data).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("surfaces an error", async () => {
    const page = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect((await fetchAllRows(page)).error).toEqual({ message: "boom" });
  });
});
