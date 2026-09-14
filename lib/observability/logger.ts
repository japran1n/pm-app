// Minimal structured logger. Zero dependencies.
//
// In production, emits one JSON line per call to stdout so log
// aggregators (Vercel, Datadog, etc.) can parse fields directly. In
// development, falls through to console.* with a readable "[level]"
// prefix so local terminals stay easy to scan.
//
// IMPORTANT (audit ARCH-006): there is NO external error-reporting
// service wired up — no Sentry, no alerting. In production this is
// stdout only; nothing pages anyone when errors spike. If/when a DSN is
// provisioned, `emit` below is the single seam to add a transport to —
// no call-site changes required.

type LogContext = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";

function emit(level: "debug" | "info" | "warn" | "error", message: string, context?: LogContext) {
  if (isProd) {
    process.stdout.write(
      JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        ...context,
      }) + "\n",
    );
    return;
  }

  const prefixed = `[${level}] ${message}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (context !== undefined) {
    fn(prefixed, context);
  } else {
    fn(prefixed);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
