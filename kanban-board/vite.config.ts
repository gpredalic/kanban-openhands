import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { inlineCss } from "./inline-css-plugin";

// Build the React app as a single self-contained ESM file named extension.js.
// - lib mode, single entry (src/entry.tsx) exporting activate(host)
// - inlineDynamicImports folds React + dnd-kit + all components into one chunk
// - the inlineCss plugin folds the emitted CSS asset into the JS as a <style>
export default defineConfig({
  plugins: [react(), inlineCss()],
  // React's dev/prod switch reads process.env.NODE_ENV. In lib mode Vite does
  // not auto-replace it (unlike app builds), so the literal `process` leaks
  // into the bundle and throws `ReferenceError: process is not defined` when
  // the host imports it via a browser blob URL. Pin it to "production" so the
  // bundle is self-contained and browser-safe.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    // Build into dist/, then the build script moves the single artifact to the
    // project root so it lands at the declared entrypoint (extension.js).
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/entry.tsx",
      formats: ["es"],
      fileName: () => "extension.js",
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
  },
});
