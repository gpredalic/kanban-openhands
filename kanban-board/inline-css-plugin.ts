import type { Plugin } from "vite";

/**
 * inlineCss — folds any emitted CSS asset into the entry JS chunk as a
 * <style> injection so the build output is a single self-contained file.
 * Mirrors how the existing vanilla extension injects BOARD_CSS.
 */
export function inlineCss(): Plugin {
  return {
    name: "inline-css",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      const cssAssets = Object.entries(bundle).filter(
        ([, b]) => b.type === "asset" && b.fileName.endsWith(".css"),
      ) as [string, { type: "asset"; fileName: string; source: unknown }][];
      const entryChunk = Object.values(bundle).find(
        (b) => b.type === "chunk" && b.isEntry,
      ) as { code: string } | undefined;
      if (!entryChunk || cssAssets.length === 0) return;
      const css = cssAssets.map(([, a]) => String(a.source)).join("\n");
      const inject =
        `const __kb_css=${JSON.stringify(css)};` +
        `const __kb_style=document.createElement('style');` +
        `__kb_style.textContent=__kb_css;document.head.appendChild(__kb_style);\n`;
      entryChunk.code = inject + entryChunk.code;
      for (const [name] of cssAssets) delete bundle[name];
    },
  };
}
