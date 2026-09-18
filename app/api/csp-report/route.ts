import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    logger.warn("CSP violation report", { report: body });
  } catch {
    // ignore parse errors — malformed or empty bodies are silently dropped
  }
  return new NextResponse(null, { status: 204 });
}
