// F280 (AS-531): Vite build for the MV3 extension skeleton.
// @crxjs/vite-plugin@2.7.1 handles manifest-driven bundling (popup HTML,
// background service worker, content scripts) the way a plain Vite config
// cannot — it rewrites manifest.json paths into hashed build outputs and
// wires the service worker into an ESM-compatible bundle for MV3.
// Verified against npm registry (`npm view @crxjs/vite-plugin versions`,
// dist-tag latest 2.7.1, peerDependency vite ^3||^4||^5||^6||^7||^8) 2026-08-19.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
      },
    },
  },
});
