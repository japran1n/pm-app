// F281: a `chrome.storage.local`-backed storage adapter for
// `@supabase/supabase-js`'s `createClient({ auth: { storage } })`.
//
// MV3 service workers have no `window`/`localStorage` and go idle after
// ~30s, so supabase-js's default storage does not work there — this is the
// documented workaround (verified against
// https://pustelto.com/blog/supabase-auth/ and
// https://gourav.io/blog/supabase-auth-chrome-extension, both current as of
// 2026-08-19, per tech-decisions.md "QA feedback extension").
//
// supabase-js's `SupportedStorage` interface (checked against the current
// @supabase/supabase-js@2.112.3 types, `gotrue-js` `SupportedStorage` in
// `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts`) requires:
//   getItem(key: string): Promise<string | null> | string | null
//   setItem(key: string, value: string): Promise<void> | void
//   removeItem(key: string): Promise<void> | void
// `chrome.storage.local` is namespaced per-extension already, so no key
// prefixing is needed beyond what supabase-js itself uses.
export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return typeof result[key] === "string" ? (result[key] as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};
