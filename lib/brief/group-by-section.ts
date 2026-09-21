// F007: group brief questions into sections by category (BR-030).
import type { BriefQuestion } from "@/lib/queries/brief";

export type BriefSection = {
  name: string;
  questions: BriefQuestion[];
  minPosition: number;
};

export function groupBySection(questions: BriefQuestion[]): BriefSection[] {
  const map = new Map<string, BriefQuestion[]>();
  for (const q of questions) {
    const key = q.category ?? "General";
    const list = map.get(key);
    if (list) list.push(q);
    else map.set(key, [q]);
  }
  return Array.from(map.entries())
    .map(([name, qs]) => ({
      name,
      questions: qs,
      minPosition: Math.min(...qs.map((q) => q.position)),
    }))
    .sort((a, b) => a.minPosition - b.minPosition);
}
