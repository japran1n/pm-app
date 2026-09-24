import { describe, expect, it } from "vitest";

import { formatLogLine, serializeError } from "@/lib/observability/logger";

// SEC-HTTP-11: the production JSON line must (a) serialize Error values
// instead of `{}` and (b) never let context overwrite level/message/time.

const NOW = new Date("2026-09-24T00:00:00.000Z");

describe("formatLogLine", () => {
  it("serializes an Error in context with name, message, stack and cause", () => {
    const cause = new TypeError("inner");
    const error = new Error("outer", { cause });
    const line = JSON.parse(formatLogLine("error", "boom", { error }, NOW));

    expect(line.error.name).toBe("Error");
    expect(line.error.message).toBe("outer");
    expect(typeof line.error.stack).toBe("string");
    expect(line.error.cause).toMatchObject({ name: "TypeError", message: "inner" });
  });

  it("serializes nested Errors and keeps structured library fields", () => {
    const err = Object.assign(new Error("auth"), { status: 429, code: "over_rate_limit" });
    const line = JSON.parse(formatLogLine("warn", "m", { nested: { err } }, NOW));
    expect(line.nested.err).toMatchObject({ message: "auth", status: 429, code: "over_rate_limit" });
  });

  it("truncates very long stacks", () => {
    const err = new Error("x");
    err.stack = "s".repeat(20_000);
    const line = JSON.parse(formatLogLine("error", "m", { err }, NOW));
    expect(line.err.stack.length).toBeLessThan(4200);
  });

  it("reserved keys cannot be overridden by context", () => {
    const line = JSON.parse(
      formatLogLine(
        "info",
        "real message",
        { message: "forged", level: "debug", timestamp: "1970", time: "t", ok: 1 },
        NOW,
      ),
    );
    expect(line.message).toBe("real message");
    expect(line.level).toBe("info");
    expect(line.timestamp).toBe(NOW.toISOString());
    expect(line.context_message).toBe("forged");
    expect(line.context_level).toBe("debug");
    expect(line.context_time).toBe("t");
    expect(line.ok).toBe(1);
  });

  it("accepts an Error passed as the whole context", () => {
    const line = JSON.parse(
      formatLogLine("error", "m", new Error("whole") as unknown as Record<string, unknown>, NOW),
    );
    expect(line.error.message).toBe("whole");
  });

  it("never throws on circular or BigInt context", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const line = JSON.parse(formatLogLine("error", "m", { circular }, NOW));
    expect(line.message).toBe("m");
    expect(line.context_unserializable).toBe(true);

    expect(JSON.parse(formatLogLine("info", "m", { n: BigInt(5) }, NOW)).n).toBe("5");
  });

  it("serializeError bounds the cause chain", () => {
    let e: Error = new Error("root");
    for (let i = 0; i < 10; i++) e = new Error(`e${i}`, { cause: e });
    let out = serializeError(e) as { cause?: unknown };
    let depth = 0;
    while (out.cause && typeof out.cause === "object") {
      out = out.cause as { cause?: unknown };
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(4);
  });
});
