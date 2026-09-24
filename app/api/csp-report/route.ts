import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { clip, readJsonCapped, redactUrl } from "@/lib/observability/report-intake";
import { checkRateLimit, clientIpFromHeaders, type RateLimitRule } from "@/lib/rate-limit";

// Receives CSP violation reports (proxy.ts `report-uri /api/csp-report`).
//
// SEC-HTTP-11: unauthenticated by necessity (browsers send reports without
// credentials), so the intake is bounded:
// - body capped at 8KB before buffering (413 over the cap);
// - only known report fields are kept, each clipped, and URLs are reduced
//   to origin + path so query-string secrets (auth codes, invite tokens)
//   never reach the log stream;
// - per-IP in-process rate limit (best-effort, per instance — a DB write per
//   report would cost more than the abuse it prevents; see lib/rate-limit.ts).
//
// Accepts both the legacy `application/csp-report` body
// (`{ "csp-report": { "document-uri": ... } }`) and the Reporting API
// `application/reports+json` body (`[{ type: "csp-violation", body: {...} }]`).

const RATE_LIMIT: RateLimitRule = { bucket: "csp_report_ip", limit: 60, windowSeconds: 60 };
const MAX_REPORTS_PER_BATCH = 10;

const str = z.union([z.string(), z.number()]).transform(String).optional();

// Legacy (kebab-case) keys.
const legacyReport = z.object({
  "document-uri": str,
  "violated-directive": str,
  "effective-directive": str,
  "blocked-uri": str,
  "source-file": str,
  "line-number": str,
  "column-number": str,
  disposition: str,
  "script-sample": str,
  "status-code": str,
});

// Reporting API (camelCase) keys.
const reportingApiBody = z.object({
  documentURL: str,
  effectiveDirective: str,
  blockedURL: str,
  sourceFile: str,
  lineNumber: str,
  columnNumber: str,
  disposition: str,
  sample: str,
  statusCode: str,
});

const legacyEnvelope = z.object({ "csp-report": legacyReport });
const reportingApiEnvelope = z
  .array(z.object({ type: z.string().optional(), body: reportingApiBody }))
  .min(1)
  .max(50);

type Violation = {
  documentUri?: string;
  directive?: string;
  blockedUri?: string;
  sourceFile?: string;
  line?: string;
  column?: string;
  disposition?: string;
  sample?: string;
};

function clean(v: Violation): Violation {
  return {
    documentUri: v.documentUri && redactUrl(v.documentUri),
    directive: v.directive && clip(v.directive, 100),
    blockedUri: v.blockedUri && redactUrl(v.blockedUri),
    sourceFile: v.sourceFile && redactUrl(v.sourceFile),
    line: v.line && clip(v.line, 12),
    column: v.column && clip(v.column, 12),
    disposition: v.disposition && clip(v.disposition, 16),
    // Browsers put up to 40 chars of the offending inline code here.
    sample: v.sample && clip(v.sample, 80),
  };
}

function parseViolations(body: unknown): Violation[] | null {
  const legacy = legacyEnvelope.safeParse(body);
  if (legacy.success) {
    const r = legacy.data["csp-report"];
    return [
      {
        documentUri: r["document-uri"],
        directive: r["effective-directive"] ?? r["violated-directive"],
        blockedUri: r["blocked-uri"],
        sourceFile: r["source-file"],
        line: r["line-number"],
        column: r["column-number"],
        disposition: r.disposition,
        sample: r["script-sample"],
      },
    ];
  }
  const batch = reportingApiEnvelope.safeParse(body);
  if (batch.success) {
    return batch.data
      .filter((r) => r.type === undefined || r.type === "csp-violation")
      .slice(0, MAX_REPORTS_PER_BATCH)
      .map(({ body: b }) => ({
        documentUri: b.documentURL,
        directive: b.effectiveDirective,
        blockedUri: b.blockedURL,
        sourceFile: b.sourceFile,
        line: b.lineNumber,
        column: b.columnNumber,
        disposition: b.disposition,
        sample: b.sample,
      }));
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!(await checkRateLimit(RATE_LIMIT, clientIpFromHeaders(req.headers)))) {
    return new NextResponse(null, { status: 429 });
  }

  const read = await readJsonCapped(req);
  if (!read.ok) {
    return new NextResponse(null, { status: read.reason === "too_large" ? 413 : 400 });
  }

  const violations = parseViolations(read.value);
  if (!violations) return new NextResponse(null, { status: 400 });

  for (const violation of violations) {
    logger.warn("CSP violation report", { report: clean(violation) });
  }
  return new NextResponse(null, { status: 204 });
}
