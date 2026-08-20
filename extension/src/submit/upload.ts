import { APP_URL } from "../lib/supabase";

// Narrower than F285's full `AnnotatedResult` (which also carries
// width/height for the annotation canvas) — this module only ever needs
// the PNG data URL itself, and this shape is also what F283's plain
// `getLastCapture()` fallback naturally provides (see report-form.tsx's
// "Screenshot/annotation resolution" comment for why both call sites are
// accepted here).
export type UploadableScreenshot = { dataUrl: string };

// F294 (AS-559, AS-566, AS-567): uploads the reporter's annotated
// screenshot (F285's AnnotatedResult, a flattened PNG data URL) to the
// already-created task via POST /api/extension/attachments (this feature's
// new Route Handler).
//
// MAX_ATTACHMENT_SIZE_BYTES is mirrored here, NOT imported, from
// lib/validation/attachments.ts — the extension is a separate Vite/tsconfig
// workspace with no path alias into the root app's `lib/` (confirmed by
// reading extension/tsconfig.json before adding this), same reason
// report-form.tsx's STATUS_OPTIONS mirrors (rather than imports)
// lib/actions/tasks.ts's status enum. If this value changes in
// lib/validation/attachments.ts, this constant must be updated to match —
// the server-side check in app/api/extension/attachments/route.ts is the
// real, authoritative enforcement boundary regardless of what this client
// constant says.
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export type UploadScreenshotResult =
  | { ok: true }
  | { ok: false; error: string };

// AS-566: the size check happens here, against the real decoded byte
// length of the PNG (not the data URL string length, which is ~33% larger
// due to base64 encoding), BEFORE any network call is made — no task
// creation or upload attempt happens for an oversized capture. This is what
// makes "rejected ... before the task is created" hold structurally: the
// caller of this function (report-form.tsx) is expected to run this check
// (via checkScreenshotSize below) prior to even calling POST
// /api/extension/tasks, not just prior to calling this upload function.
export function checkScreenshotSize(screenshot: UploadableScreenshot): UploadScreenshotResult {
  const byteLength = dataUrlByteLength(screenshot.dataUrl);
  if (byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      error: `Screenshot must be ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
    };
  }
  return { ok: true };
}

// Decodes a base64 data URL's real byte length without materializing the
// full binary (a cheap, allocation-free size check) — base64 encodes 3
// bytes as 4 characters, with up to 2 trailing `=` padding characters.
function dataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = /data:([^;]+);base64/.exec(meta ?? "");
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// Uploads the annotated screenshot to an already-created task (see this
// module's doc comment and the route's own comment for why task creation
// must happen first). Called from report-form.tsx only AFTER task creation
// has already succeeded — a failure here never rolls back or otherwise
// touches the task, since the task has no attachment-reference field of its
// own to leave "broken" (AS-567) — see app/api/extension/attachments/route.ts's
// doc comment for the full reasoning.
export async function uploadScreenshotForTask(params: {
  accessToken: string;
  taskId: string;
  screenshot: UploadableScreenshot;
}): Promise<UploadScreenshotResult> {
  const sizeCheck = checkScreenshotSize(params.screenshot);
  if (!sizeCheck.ok) {
    return sizeCheck;
  }

  try {
    const blob = dataUrlToBlob(params.screenshot.dataUrl);
    const formData = new FormData();
    formData.append("taskId", params.taskId);
    formData.append("file", blob, "screenshot.png");

    const res = await fetch(`${APP_URL}/api/extension/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}` },
      body: formData,
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? "Failed to attach screenshot.",
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to attach screenshot." };
  }
}
