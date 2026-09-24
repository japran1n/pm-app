// SEC-HTTP-11: shared intake for the unauthenticated browser report
// endpoints (/api/csp-report, /api/client-errors). Both accept a small JSON
// body from any visitor, so the body is size-capped BEFORE it is buffered
// (a declared Content-Length over the cap is rejected without reading; an
// undeclared/chunked body is read incrementally and abandoned as soon as it
// crosses the cap), then parsed as JSON.

export const MAX_REPORT_BODY_BYTES = 8 * 1024;

export type ReadJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid" };

export async function readJsonCapped(
  req: Request,
  maxBytes: number = MAX_REPORT_BODY_BYTES,
): Promise<ReadJsonResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: "too_large" };
  }

  if (!req.body) return { ok: false, reason: "invalid" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Truncates a string to `max` characters. */
export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Reduces a URL to origin + path (drops query and fragment, which can hold
 * auth codes, invite tokens or other secrets) and clips it. Non-URL values
 * (e.g. CSP keywords like "inline" / "eval") are returned clipped.
 */
export function redactUrl(value: string, max = 300): string {
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return clip(`${u.origin}${u.pathname}`, max);
    }
    // data:, blob:, chrome-extension:, etc. — scheme only.
    return clip(`${u.protocol}`, max);
  } catch {
    return clip(value, max);
  }
}
