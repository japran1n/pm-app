// Unit tests for F03 (SP-050, SP-051): pure guard-chain helpers used by the
// staging-preview probe route. `readFramingPolicy` and `isBlockedAddress`
// live in lib/site-preview/guards.ts (F02 extracted the guard chain out of
// this route so both the probe and the HTML proxy share one copy — see that
// file's doc comment). Import from there, not from this route module.

import { describe, expect, it } from "vitest";

import { isBlockedAddress, readFramingPolicy } from "@/lib/site-preview/guards";

const SELF_ORIGIN = "https://self.test";

describe("test_SP_050_readFramingPolicy", () => {
  it.each<{ name: string; headers: Record<string, string>; expected: boolean }>([
    {
      name: "x-frame-options DENY blocks embedding",
      headers: { "x-frame-options": "DENY" },
      expected: false,
    },
    {
      name: "x-frame-options sameorigin blocks embedding",
      headers: { "x-frame-options": "sameorigin" },
      expected: false,
    },
    {
      name: "x-frame-options with surrounding whitespace and mixed case still blocks",
      headers: { "x-frame-options": "  SAMEORIGIN " },
      expected: false,
    },
    {
      name: "csp frame-ancestors 'none' blocks embedding",
      headers: { "content-security-policy": "frame-ancestors 'none'" },
      expected: false,
    },
    {
      name: "csp frame-ancestors naming a different origin blocks embedding",
      headers: { "content-security-policy": "frame-ancestors https://other.com" },
      expected: false,
    },
    {
      name: "csp frame-ancestors wildcard allows embedding",
      headers: { "content-security-policy": "frame-ancestors *" },
      expected: true,
    },
    {
      name: "csp frame-ancestors naming the self origin allows embedding",
      headers: { "content-security-policy": "frame-ancestors https://self.test" },
      expected: true,
    },
    {
      name: "csp without a frame-ancestors directive allows embedding",
      headers: { "content-security-policy": "default-src 'self'" },
      expected: true,
    },
    {
      name: "no framing headers at all allows embedding",
      headers: {},
      expected: true,
    },
  ])("$name", ({ headers, expected }) => {
    const result = readFramingPolicy(new Headers(headers), SELF_ORIGIN);
    expect(result.embeddable).toBe(expected);
  });
});

describe("test_SP_051_isBlockedAddress", () => {
  it.each([
    { ip: "127.0.0.1", blocked: true },
    { ip: "127.1.2.3", blocked: true },
    { ip: "10.0.0.1", blocked: true },
    { ip: "172.16.0.1", blocked: true },
    { ip: "172.31.255.255", blocked: true },
    { ip: "192.168.1.1", blocked: true },
    { ip: "169.254.169.254", blocked: true },
    { ip: "100.64.0.1", blocked: true },
    { ip: "0.0.0.0", blocked: true },
    { ip: "::1", blocked: true },
    { ip: "fc00::1", blocked: true },
    { ip: "fe80::1", blocked: true },
    { ip: "1.1.1.1", blocked: false },
    { ip: "172.32.0.1", blocked: false },
    { ip: "192.169.0.1", blocked: false },
    { ip: "2606:4700::1111", blocked: false },
  ])("$ip is blocked=$blocked", ({ ip, blocked }) => {
    expect(isBlockedAddress(ip)).toBe(blocked);
  });
});
