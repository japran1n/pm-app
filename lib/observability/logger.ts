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
//
// SEC-HTTP-11: in production,
// - `Error` values anywhere in the context are serialized as
//   `{ name, message, stack, cause, code?, status? }` — `JSON.stringify`
//   alone renders an Error as `{}`, which silently dropped every caught
//   exception passed as `{ error }` by ~150 catch blocks.
// - the reserved keys (`level`, `message`, `timestamp`, `time`) cannot be
//   overwritten by context. A colliding context key is kept under
//   `context_<key>` instead, so a caller (or an attacker-controlled field
//   forwarded from a request) can never forge the level or message.
// - a context that cannot be serialized (circular, BigInt, throwing
//   getters) degrades to a marker instead of throwing out of the logger.

type LogContext = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

const isProd = process.env.NODE_ENV === "production";

export const RESERVED_LOG_KEYS: ReadonlySet<string> = new Set([
  "level",
  "message",
  "timestamp",
  "time",
]);

const MAX_STACK_CHARS = 4000;
const MAX_MESSAGE_CHARS = 2000;
const MAX_CAUSE_DEPTH = 3;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max}]` : value;
}

export function serializeError(error: Error, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: truncate(String(error.message ?? ""), MAX_MESSAGE_CHARS),
  };
  if (typeof error.stack === "string") out.stack = truncate(error.stack, MAX_STACK_CHARS);
  // Common structured fields on library errors (Supabase AuthError,
  // PostgrestError-derived errors, Node system errors).
  const extra = error as unknown as Record<string, unknown>;
  for (const key of ["code", "status", "digest", "details", "hint"]) {
    const v = extra[key];
    if (typeof v === "string" || typeof v === "number") out[key] = v;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    if (cause instanceof Error) {
      out.cause =
        depth < MAX_CAUSE_DEPTH ? serializeError(cause, depth + 1) : { name: cause.name, message: cause.message };
    } else {
      out.cause = cause;
    }
  }
  return out;
}

function replacer(this: unknown, _key: string, value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * Builds the production log line. Exported for tests; the public API is
 * `logger` below.
 */
export function formatLogLine(
  level: Level,
  message: string,
  context?: LogContext,
  now: Date = new Date(),
): string {
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: now.toISOString(),
  };

  // Tolerate an Error (or other non-plain value) passed as the whole
  // context via a cast at a call site.
  const ctx: LogContext | undefined =
    context instanceof Error ? { error: context } : context;

  if (ctx && typeof ctx === "object") {
    for (const key of Object.keys(ctx)) {
      const target = RESERVED_LOG_KEYS.has(key) ? `context_${key}` : key;
      entry[target] = ctx[key];
    }
  }

  try {
    return JSON.stringify(entry, replacer);
  } catch {
    // Circular structure or a throwing toJSON/getter: keep the line.
    return JSON.stringify({
      level,
      message,
      timestamp: entry.timestamp,
      context_unserializable: true,
      contextKeys: ctx ? Object.keys(ctx).slice(0, 50) : [],
    });
  }
}

function emit(level: Level, message: string, context?: LogContext) {
  if (isProd) {
    process.stdout.write(formatLogLine(level, message, context) + "\n");
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
