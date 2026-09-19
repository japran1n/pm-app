// TH-054..057, TH-055 — host allowlist predicate for the Webflow source
// proxies. `isWebflowHost` must accept subdomains of webflow.io (staging and
// live sites) but reject the bare apex `webflow.io` -- that's Webflow's own
// marketing site, never a customer's site.

import { describe, expect, it } from "vitest";
import { isWebflowHost } from "@/lib/site-preview/guards";

describe("isWebflowHost", () => {
  it("test_TH_055_accepts_a_webflow_io_subdomain", () => {
    expect(isWebflowHost("https://my-site.webflow.io/")).toBe(true);
  });

  it("test_TH_055_accepts_a_staging_prefixed_webflow_io_subdomain", () => {
    expect(isWebflowHost("https://my-site-abc123.webflow.io/page")).toBe(true);
  });

  it("test_TH_055_rejects_the_bare_webflow_io_apex", () => {
    expect(isWebflowHost("https://webflow.io")).toBe(false);
    expect(isWebflowHost("https://webflow.io/")).toBe(false);
  });

  it("test_TH_055_rejects_a_non_webflow_host", () => {
    expect(isWebflowHost("https://example.com")).toBe(false);
  });

  it("test_TH_055_rejects_a_lookalike_host", () => {
    expect(isWebflowHost("https://webflow.io.evil.com")).toBe(false);
  });

  it("test_TH_055_rejects_non_https_scheme", () => {
    expect(isWebflowHost("http://my-site.webflow.io/")).toBe(false);
  });

  it("test_TH_055_rejects_unparseable_input", () => {
    expect(isWebflowHost("not-a-url")).toBe(false);
  });
});
