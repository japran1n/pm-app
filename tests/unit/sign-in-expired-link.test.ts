import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import SignInPage from "@/app/(auth)/sign-in/page";

describe("SignInPage error state (AS-004: expired/used magic link)", () => {
  it("AS-004: shows the expired-link message inline above the sign-in form when ?error=auth_failed", async () => {
    const element = await SignInPage({
      searchParams: Promise.resolve({ error: "auth_failed" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("This link has expired or was already used");
    // The same sign-in form must still be present — not a dead-end page.
    expect(html).toContain("Send magic link");
  });

  it("AS-004: shows no error message when there is no error query param", async () => {
    const element = await SignInPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("This link has expired or was already used");
    expect(html).toContain("Send magic link");
  });

  it("AS-004: ignores unrelated/unknown error values (only auth_failed triggers the message)", async () => {
    const element = await SignInPage({
      searchParams: Promise.resolve({ error: "something_else" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("This link has expired or was already used");
  });
});
