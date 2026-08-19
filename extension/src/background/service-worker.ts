// F280 (AS-531): background service worker skeleton. No capture/auth logic
// yet — those land in later M19 features. Kept intentionally minimal so the
// MV3 skeleton has a valid, loadable service worker entry point.
chrome.runtime.onInstalled.addListener(() => {
  console.log("[pm-app-qa-feedback] service worker installed");
});
