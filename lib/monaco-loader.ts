// F002 (TH-175): `@monaco-editor/react` defaults to fetching the Monaco
// runtime from the jsdelivr CDN on first mount unless `loader.config` is
// called first with the locally-installed `monaco-editor` npm package.
// Calling `configureMonaco()` once, before any `<Editor />` mounts, points
// the loader at the local bundle so the editor's language services never
// request a third-party origin (TH-175).
//
// `loader.config` is idempotent — the underlying `@monaco-editor/react`
// loader just overwrites its internal config object on each call, so
// calling `configureMonaco()` more than once (e.g. from multiple client
// components that each render an editor) is safe and last-write-wins,
// matching this feature's "concurrent access" default.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

let configured = false;

/**
 * Point `@monaco-editor/react` at the locally-installed `monaco-editor`
 * package instead of its jsdelivr CDN default. Call once at app startup,
 * before any `<Editor />` mounts (e.g. from the root layout or a client
 * component that wraps the editor).
 */
export function configureMonaco(): void {
  loader.config({ monaco });
  configured = true;
}

/** Test/debug helper: whether `configureMonaco()` has run in this module instance. */
export function isMonacoConfigured(): boolean {
  return configured;
}
