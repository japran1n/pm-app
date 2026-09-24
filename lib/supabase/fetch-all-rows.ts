// DB-ACCESS-04: PostgREST caps every response at `max_rows` (1000 on this
// project). An unbounded `.select()` whose rows are then counted or summed
// in JS silently under-reports once a result passes that cap — no error,
// just a wrong total. Use this to page through every row with `.range()`.
//
// The builder MUST apply a total, deterministic order (end with a unique
// column such as `id`), otherwise rows can repeat or be skipped between
// pages. Prefer a SQL aggregate (RPC / `count: "exact", head: true`) where
// one exists; this is for reads that genuinely need every row client-side.

export const POSTGREST_MAX_ROWS = 1000;

type PageResult<T, E> = PromiseLike<{ data: T[] | null; error: E | null }>;

export async function fetchAllRows<T, E = unknown>(
  page: (from: number, to: number) => PageResult<T, E>,
  pageSize: number = POSTGREST_MAX_ROWS,
): Promise<{ data: T[]; error: E | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
}
