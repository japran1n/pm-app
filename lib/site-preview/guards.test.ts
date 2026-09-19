// F022 — cappedBodyReader tests (TH-062, TH-063, TH-070)

import { describe, expect, it } from "vitest";
import { BodyTooLargeError, cappedBodyReader } from "@/lib/site-preview/guards";

function responseFromBytes(byteLength: number): Response {
  const bytes = new Uint8Array(byteLength).fill(97); // 'a'
  return new Response(bytes);
}

describe("cappedBodyReader", () => {
  it("TH-062: returns the string body when it is under the limit", async () => {
    const res = responseFromBytes(10);
    const body = await cappedBodyReader(res, 100);
    expect(body).toBe("a".repeat(10));
  });

  it("TH-062 (boundary): returns the string body when it is exactly at the limit", async () => {
    const res = responseFromBytes(100);
    const body = await cappedBodyReader(res, 100);
    expect(body).toBe("a".repeat(100));
  });

  it("TH-063: throws BodyTooLargeError when the body exceeds maxBytes by one byte", async () => {
    const res = responseFromBytes(101);
    await expect(cappedBodyReader(res, 100)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("TH-063: default maxBytes is 2MB and larger bodies still throw", async () => {
    const res = responseFromBytes(2 * 1024 * 1024 + 1);
    await expect(cappedBodyReader(res)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });
});
