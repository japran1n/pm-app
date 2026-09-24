// Runs raw SQL against the hosted project through the Supabase Management
// API — the same mechanism scripts/apply-migration.mjs uses (the project is
// remote-only, so there is no direct Postgres connection string in .env).
// Needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF. Never logs either.

export async function runSql<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    throw new Error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF");
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`SQL failed (${response.status}): ${body.slice(0, 2000)}`);
  }
  const parsed = JSON.parse(body) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** Single-quote a string literal for SQL. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
