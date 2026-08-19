// F280 (AS-531): background service worker skeleton, no capture/auth logic
// yet — those land in later M19 features.
//
// F281 (AS-532, AS-538): handles the session handoff. When
// `src/content/extension-connect.ts` relays a one-time token read from
// pm-app's `/extension-connect` page, this worker redeems it against the
// server (`app/(auth)/extension-connect/exchange/route.ts` — the server
// resolves identity from the token itself, this worker never claims an
// identity) and writes the resulting session into
// `chrome.storage.local` via supabase-js's own `setSession`, so the
// storage adapter (`src/lib/chrome-storage-adapter.ts`) persists it in the
// exact shape supabase-js expects to read back.
import { APP_URL, createExtensionSupabaseClient } from "../lib/supabase";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[pm-app-qa-feedback] service worker installed");
});

type HandoffMessage = { type: "EXTENSION_HANDOFF_TOKEN"; token: string };

function isHandoffMessage(message: unknown): message is HandoffMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type?: unknown }).type === "EXTENSION_HANDOFF_TOKEN" &&
    typeof (message as { token?: unknown }).token === "string"
  );
}

async function exchangeHandoffToken(token: string): Promise<void> {
  const response = await fetch(`${APP_URL}/extension-connect/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    // Token already used/expired/invalid — every failure state states what
    // happened rather than silently no-oping; the popup surfaces this via
    // connection status ("Not connected") since no session gets written.
    const body = await response.json().catch(() => ({}));
    console.error(
      "[pm-app-qa-feedback] extension handoff exchange failed:",
      response.status,
      body,
    );
    return;
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string | null };
  };

  const supabase = createExtensionSupabaseClient();
  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });

  if (error) {
    console.error(
      "[pm-app-qa-feedback] failed to establish extension session:",
      error.message,
    );
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isHandoffMessage(message)) {
    void exchangeHandoffToken(message.token);
  }
});
