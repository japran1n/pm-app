// F022 — cappedBodyReader tests (TH-062, TH-063, TH-070)

import { describe, expect, it } from "vitest";
import {
  BodyTooLargeError,
  cappedBodyReader,
  isBlockedAddress,
} from "@/lib/site-preview/guards";

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

describe("isBlockedAddress — alternate spellings and reserved ranges", () => {
  it.each([
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:10.0.0.1",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "::127.0.0.1",
    "0.0.0.0",
    "0.0.0.1",
    "0.255.255.255",
    "100.64.0.1",
    "192.0.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001::1",
    "fe80::1%en0",
    "fd00::1",
    "fec0::1",
    "ff02::1",
    "localhost",
    "not-an-ip",
    "",
  ])("%s is blocked", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "93.184.215.14",
    "1.1.1.1",
    "8.8.8.8",
    "::ffff:93.184.215.14",
    "2606:4700::1111",
    "2a00:1450:4001:80b::200e",
    "64:ff9b::808:808",
    "2002:5db8:d70e::",
  ])("%s is allowed", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});
