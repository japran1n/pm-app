// F281 (AS-532): content script scoped (see manifest.json `content_scripts`
// `matches`) to only the pm-app web app's own `/extension-connect` page —
// this is deliberately narrower and more private than
// `externally_connectable`: it never *listens* for messages from any web
// origin, it only *reads* a DOM node that page rendered for an
// already-authenticated request, then relays it internally via
// `chrome.runtime.sendMessage` to this same extension's own background
// worker. An arbitrary site cannot trigger this — the pattern in
// manifest.json only matches pm-app's own connect page, and even if a
// malicious page were injected with the same origin+path (i.e. it would
// have to *be* pm-app), all it can do is read one data attribute the page
// itself renders server-side from a real session.
function relayHandoffToken(): void {
  const node = document.querySelector<HTMLElement>(
    "[data-testid='extension-handoff']",
  );
  const token = node?.dataset.extensionToken;
  if (!token) {
    return;
  }

  chrome.runtime.sendMessage({ type: "EXTENSION_HANDOFF_TOKEN", token });
}

relayHandoffToken();

// The page renders the token node synchronously in its initial HTML
// (Server Component), but observe for late hydration/navigation just in
// case, and stop once we've successfully relayed a token.
const observer = new MutationObserver(() => {
  relayHandoffToken();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
