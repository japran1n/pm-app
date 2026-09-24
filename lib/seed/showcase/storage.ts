// Storage side of the showcase seed: tiny real placeholder files so
// attachment downloads, chat files and before/after images actually open.

import { randomBytes } from "node:crypto";
import { mockScreenshot } from "./png";
import type { Admin } from "./util";
import { assertCleanupConfirmed } from "./cleanup";

export type FileKind = "png" | "pdf" | "csv" | "txt";

const MIME: Record<FileKind, string> = {
  png: "image/png",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
};

function minimalPdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, "");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "", // content stream, filled below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 20 Tf 60 760 Td (${text}) Tj ET\nBT /F1 11 Tf 60 730 Td (Good Guys x Nordvik Outdoor AB - placeholder document) Tj ET`;
  objects[3] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export function fileContent(kind: FileKind, name: string, accent = "#3f6b4f", variant = 0): Buffer {
  switch (kind) {
    case "png":
      return mockScreenshot(accent, variant);
    case "pdf":
      return minimalPdf(name.replace(/\.pdf$/, "").replace(/-/g, " "));
    case "csv":
      return Buffer.from(
        name.includes("redirect")
          ? "old_url,new_url,status\n/shop/talt,/collections/talt,301\n/shop/sovsackar,/collections/sovsackar,301\n/om-oss,/about,301\n/hallbarhet,/sustainability,301\n"
          : "date,metric,value\n2026-07-01,lcp_p75_s,3.2\n2026-08-01,lcp_p75_s,2.4\n2026-09-01,lcp_p75_s,2.2\n",
      );
    case "txt":
      return Buffer.from(
        "TENTS\nSleep well wherever the trail ends. Our tents are tested in the Swedish mountains...\n\nSLEEPING BAGS\nWarmth you can rely on, from summer nights to minus fifteen...\n",
      );
  }
}

export function mimeOf(kind: FileKind): string {
  return MIME[kind];
}

export function storageSafeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function uniquePrefix(): string {
  return `${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export async function upload(admin: Admin, bucket: string, path: string, body: Buffer, contentType: string) {
  const { error } = await admin.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
}

async function listAll(admin: Admin, bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(admin, bucket, full)));
      else out.push(full);
    }
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Removes the storage objects that belonged to the rows cleanup() wiped —
 * an explicit list collected from the showcase workspace's own rows (see
 * CleanupReport.storagePlan), plus avatars of the demo users it deleted.
 *
 * SAFETY (audit 2026-09-24): this used to empty the task/chat/scope buckets
 * completely and delete every avatar not on an allow-list, across every
 * workspace. It now never lists-and-empties a bucket, and it requires the
 * same SHOWCASE_CLEANUP_CONFIRM=<project ref> opt-in as cleanup().
 */
export async function removeShowcaseFiles(
  admin: Admin,
  plan: { bucket: string; paths: string[] }[],
  deletedUserIds: string[],
  { dryRun = true }: { dryRun?: boolean } = {},
): Promise<number> {
  assertCleanupConfirmed();
  let removed = 0;
  const remove = async (bucket: string, paths: string[]) => {
    const clean = paths.filter((p) => p && !p.endsWith("/"));
    if (!dryRun) {
      for (let i = 0; i < clean.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(clean.slice(i, i + 100));
        if (error) throw new Error(`remove from ${bucket}: ${error.message}`);
      }
    }
    removed += clean.length;
  };
  for (const { bucket, paths } of plan) {
    await remove(bucket, paths);
  }
  const deleted = new Set(deletedUserIds);
  if (deleted.size > 0) {
    const avatars = await listAll(admin, "avatars");
    await remove(
      "avatars",
      avatars.filter((p) => {
        const [first] = p.split("/");
        return first !== "workspace-logos" && deleted.has(first);
      }),
    );
  }
  return removed;
}
