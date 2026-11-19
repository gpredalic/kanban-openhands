/**
 * setup.ts — installs a happy-dom window as the global DOM environment so the
 * extension's browser-only modules (document, localStorage, Blob, URL) can be
 * exercised headlessly under `node --test`.
 *
 * Import this module FIRST in every test file (it has side effects). It wires
 * the happy-dom Window's properties onto globalThis and exposes a fresh
 * `window` for assertions.
 */

import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });

// Wire the DOM surface onto the Node global scope.
const g = globalThis as Record<string, unknown>;
g.window = window;
g.document = window.document;
g.localStorage = window.localStorage;
g.Blob = window.Blob;
g.URL = window.URL;
g.HTMLElement = window.HTMLElement;
g.HTMLButtonElement = window.HTMLButtonElement;
g.DragEvent = window.DragEvent;
// Node 24 exposes a read-only `navigator` global (getter only). Guard the
// assignment so the happy-dom navigator is used only when it can be set.
try {
  g.navigator = window.navigator;
} catch {
  // Leave Node's built-in navigator in place; the board UI does not rely on
  // happy-dom's navigator for the paths exercised here.
}
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);

// happy-dom's URL.createObjectURL is a no-op stub; make it return a stable
// object URL so downloadExport() can run without throwing.
if (typeof (window.URL as unknown as { createObjectURL?: unknown }).createObjectURL !== "function") {
  (window.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
    "blob:mock-object-url";
  (window.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
}

export { window };
