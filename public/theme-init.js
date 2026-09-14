// No-FOUC theme bootstrap. Loaded as a blocking <script src> from
// app/layout.tsx <head> (audit NX-002/AS-148: an external file instead of
// an inline dangerouslySetInnerHTML script, so a strict CSP needs no
// 'unsafe-inline' and the AS-148 "zero raw-HTML sinks" guarantee holds).
// Must stay dependency-free and synchronous: it runs before first paint.
(function () {
  try {
    var t = localStorage.getItem("theme");
    var d = document.documentElement;
    if (t === "light") {
      d.classList.remove("dark");
      d.removeAttribute("data-theme");
    } else {
      d.classList.add("dark");
      d.setAttribute("data-theme", "dark");
    }
  } catch (e) {}
})();
