import { randomUUID } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type Admin = ReturnType<typeof createAdminClient>;
type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables & string;
export type Insert<T extends TableName> = Tables[T]["Insert"];

// "Today" is pinned so re-running the seed on another day still tells the
// same story. Override with SHOWCASE_TODAY=YYYY-MM-DD.
export const TODAY = process.env.SHOWCASE_TODAY ?? "2026-09-23";

export const uuid = () => randomUUID();

export function day(offset: number): string {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Timestamp `offset` days from TODAY at hh:mm Stockholm-ish (UTC+2 in Sept). */
export function at(offset: number, hour = 10, minute = 0): string {
  const d = new Date(`${day(offset)}T00:00:00Z`);
  d.setUTCHours(hour - 2, minute, 0, 0);
  return d.toISOString();
}

export function dateOf(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function isWeekend(iso: string): boolean {
  const dow = dateOf(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Deterministic PRNG so every run produces the same numbers. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function insertRows<T extends TableName>(
  admin: Admin,
  table: T,
  rows: Insert<T>[],
  counts?: Record<string, number>,
): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from(table).insert(chunk as any);
    if (error) {
      throw new Error(`insert ${table}: ${error.message}${error.details ? ` (${error.details})` : ""}`);
    }
  }
  if (counts) counts[table] = (counts[table] ?? 0) + rows.length;
}

// --- TipTap JSON helpers ---------------------------------------------------

export type Inline = string | { mention: string } | { bold: string } | { link: string; href: string };

function inlineNodes(parts: Inline[]) {
  return parts.map((p) => {
    if (typeof p === "string") return { type: "text", text: p };
    if ("mention" in p) return { type: "mention", attrs: { id: p.mention } };
    if ("bold" in p) return { type: "text", text: p.bold, marks: [{ type: "bold" }] };
    return { type: "text", text: p.link, marks: [{ type: "link", attrs: { href: p.href } }] };
  });
}

/** Plain-text mirror: mentions render as @<uuid>, matching the app's own body_text. */
export function inlineText(parts: Inline[]): string {
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      if ("mention" in p) return `@${p.mention}`;
      if ("bold" in p) return p.bold;
      return p.link;
    })
    .join("");
}

export function richDoc(paragraphs: Inline[][]) {
  return {
    json: {
      type: "doc",
      content: paragraphs.map((parts) => ({ type: "paragraph", content: inlineNodes(parts) })),
    },
    text: paragraphs.map(inlineText).join("\n"),
  };
}
