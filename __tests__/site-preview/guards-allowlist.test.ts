// F020 (TH-054, TH-055, TH-056, TH-057) — pure allowlist predicate tests.
// isWebflowHost must accept only https URLs whose hostname's last two
// dot-separated labels are exactly ["webflow", "io"]. It must never rely on
// String.endsWith on the raw URL or hostname, which would be fooled by query
// strings, paths, or host-suffix tricks like `evil.com.webflow.io.evil.com`.

import { describe, expect, it } from "vitest";
import { isWebflowHost } from "@/lib/site-preview/guards";

describe("isWebflowHost", () => {
  // TH-054: valid *.webflow.io URLs
  it("TH-054: returns true for a top-level *.webflow.io URL", () => {
    expect(isWebflowHost("https://site.webflow.io")).toBe(true);
  });

  it("TH-054: returns true for a nested subdomain of webflow.io", () => {
    expect(isWebflowHost("https://sub.site.webflow.io")).toBe(true);
  });

  it("TH-054: returns true for a *.webflow.io URL with a path", () => {
    expect(isWebflowHost("https://site.webflow.io/some/path")).toBe(true);
  });

  // TH-055: non-webflow domains
  it("TH-055: returns false for an unrelated domain", () => {
    expect(isWebflowHost("https://evil.com")).toBe(false);
  });

  it("TH-055: returns false for a different TLD on webflow", () => {
    expect(isWebflowHost("https://site.webflow.com")).toBe(false);
  });

  it("TH-055: returns false for an unparseable URL", () => {
    expect(isWebflowHost("not-a-url")).toBe(false);
  });

  // TH-056: protocol must be https
  it("TH-056: returns false for http:// even on a valid webflow.io host", () => {
    expect(isWebflowHost("http://site.webflow.io")).toBe(false);
  });

  it("TH-056: returns false for other protocols on a webflow.io host", () => {
    expect(isWebflowHost("ftp://site.webflow.io")).toBe(false);
  });

  // TH-057: bypass vectors
  it("TH-057: returns false when webflow.io appears only as a host suffix trick", () => {
    expect(isWebflowHost("https://site.webflow.io.evil.com")).toBe(false);
  });

  it("TH-057: returns false when webflow.io appears only in the query string", () => {
    expect(isWebflowHost("https://example.com?x=.webflow.io")).toBe(false);
  });

  it("TH-057: returns false when webflow.io appears only in the path", () => {
    expect(isWebflowHost("https://evil.com/webflow.io")).toBe(false);
  });

  it("TH-057: returns false when evil.com is embedded as a subdomain label before webflow.io.evil.com", () => {
    expect(isWebflowHost("https://evil.com.webflow.io.evil.com")).toBe(false);
  });

  it("TH-057: returns false for a bare hostname with no dot", () => {
    expect(isWebflowHost("https://webflow")).toBe(false);
  });
});
