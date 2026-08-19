import { createClient } from "@supabase/supabase-js";

import { chromeStorageAdapter } from "./chrome-storage-adapter";

// F281 (AS-532, AS-538): the extension's Supabase client.
//
// Only `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_*` key, safe to
// ship to the browser — mirrors the root app's `NEXT_PUBLIC_SUPABASE_
// PUBLISHABLE_KEY`, see .env.example / lib/supabase/client.ts) is embedded
// here. The secret key never enters this workspace's source or env files;
// scripts/check-no-secret-key.mjs fails the build if one ever appears in
// dist/.
//
// `auth.storage` uses the chrome.storage.local adapter (see
// chrome-storage-adapter.ts) because MV3 service workers have no
// `localStorage`. `persistSession`/`autoRefreshToken` are left on so
// supabase-js manages refresh once a session has been written by the
// handoff flow (background/service-worker.ts writes it after redeeming a
// one-time token from app/(auth)/extension-connect/exchange/route.ts).
export function createExtensionSupabaseClient() {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        storage: chromeStorageAdapter,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  );
}

export const APP_URL: string = import.meta.env.VITE_APP_URL;
