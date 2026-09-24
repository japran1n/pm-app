import dns from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/queries/project-site", () => ({ getProjectStagingLinks: vi.fn() }));

import {
  SafeFetchError,
  pinnedLookup,
  safeFetch,
  transport,
} from "@/lib/site-preview/safe-fetch";

const PUBLIC = [{ address: "93.184.215.14", family: 4 }];

const realTransport = transport.fetch;
const realPromisesLookup = dns.promises.lookup;
const realLookup = dns.lookup;
let fetchMock: ReturnType<typeof vi.fn>;

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("ok"));
  transport.fetch = fetchMock as unknown as typeof transport.fetch;
  dns.promises.lookup = vi.fn(async (host: string) =>
    host === "internal.example.com"
      ? [{ address: "::ffff:127.0.0.1", family: 6 }]
      : PUBLIC,
  ) as unknown as typeof dns.promises.lookup;
});

afterEach(() => {
  transport.fetch = realTransport;
  dns.promises.lookup = realPromisesLookup;
  dns.lookup = realLookup;
});

describe("safeFetch", () => {
  it("fetches a public host with manual redirects", async () => {
    const { response, url } = await safeFetch("https://example.com/a", { timeoutMs: 1000 });
    expect(await response.text()).toBe("ok");
    expect(url.toString()).toBe("https://example.com/a");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it.each([
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[::]/",
    "https://0.0.0.1/",
    "https://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/",
    "https://foo.localhost/",
    "https://internal.example.com/",
  ])("rejects %s without requesting it", async (target) => {
    dns.promises.lookup = realPromisesLookup;
    if (target.includes("internal.example.com")) {
      dns.promises.lookup = vi.fn(async () => [
        { address: "::ffff:127.0.0.1", family: 6 },
      ]) as unknown as typeof dns.promises.lookup;
    }
    await expect(safeFetch(target, { timeoutMs: 1000 })).rejects.toMatchObject({
      code: "blocked",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-validates each redirect hop before following it", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://internal.example.com/secret"));
    await expect(
      safeFetch("https://example.com/", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "blocked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public host", async () => {
    fetchMock.mockResolvedValueOnce(redirect("/next", 301));
    const { url } = await safeFetch("https://example.com/", { timeoutMs: 1000 });
    expect(url.toString()).toBe("https://example.com/next");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect that downgrades to http", async () => {
    fetchMock.mockResolvedValueOnce(redirect("http://example.com/"));
    await expect(
      safeFetch("https://example.com/", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "bad_redirect" });
  });

  it("caps the redirect chain", async () => {
    fetchMock.mockImplementation(async () => redirect("https://example.com/loop"));
    await expect(
      safeFetch("https://example.com/", { timeoutMs: 1000, maxRedirects: 3 }),
    ).rejects.toMatchObject({ code: "too_many_redirects" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("applies the caller allowlist to every hop", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://evil.example.org/"));
    await expect(
      safeFetch("https://site.webflow.io/", {
        timeoutMs: 1000,
        allowUrl: (u) => u.hostname.endsWith(".webflow.io"),
      }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirect: manual returns the 3xx response as-is", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://internal.example.com/"));
    const { response } = await safeFetch("https://example.com/", {
      timeoutMs: 1000,
      method: "HEAD",
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pinnedLookup (connect-time DNS rebinding guard)", () => {
  function stubLookup(addresses: dns.LookupAddress[]) {
    dns.lookup = ((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, addresses)) as unknown as typeof dns.lookup;
  }

  it("refuses to connect when the host now resolves to a blocked address", async () => {
    stubLookup([...PUBLIC, { address: "::ffff:169.254.169.254", family: 6 }]);
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      pinnedLookup("rebind.example.com", { all: true }, (e) => resolve(e)),
    );
    expect(err?.code).toBe("EBLOCKEDADDRESS");
  });

  it("returns the checked addresses in both callback shapes", async () => {
    stubLookup(PUBLIC);
    const all = await new Promise<unknown>((resolve) =>
      pinnedLookup("example.com", { all: true }, (_e, a) => resolve(a)),
    );
    expect(all).toEqual(PUBLIC);
    const single = await new Promise<unknown[]>((resolve) =>
      pinnedLookup("example.com", {}, (_e, a, f) => resolve([a, f])),
    );
    expect(single).toEqual(["93.184.215.14", 4]);
  });
});
