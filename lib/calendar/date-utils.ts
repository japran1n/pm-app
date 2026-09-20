// Pure date utilities for calendar features. No Supabase or next/headers
// imports allowed here -- this file must be safe to import from Client
// Components.

/**
 * Every DateOnly string ("YYYY-MM-DD") from `startDate` to `endDate`
 * inclusive.
 */
export function eachDateInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
