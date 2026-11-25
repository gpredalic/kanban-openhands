/**
 * entry.tsx — extension entrypoint.
 *
 * The `activate(host)` function is called by Agent Canvas when the extension
 * is loaded. It:
 *   1. Registers the "board" page, which mounts the React Kanban board.
 *   2. Returns a cleanup function that unmounts the React root and
 *      unregisters the page.
 *
 * The board itself (state store, data controller, columns, task cards) is
 * wired up by the KanbanBoard React component — this file is the thin glue
 * between the host API and the React tree.
 */

import { createRoot, type Root } from "react-dom/client";
import { KanbanBoard } from "./components/KanbanBoard";
import type { Host } from "./types/task";
import "./styles/globals.css";

/**
 * Inject the Nunito web font into the host document head.
 *
 * The extension is a single self-contained bundle (no external CSS assets),
 * so the font is loaded at activation time from the Google Fonts CDN. The
 * link is idempotent — a second activation reuses the existing link. Nunito
 * is the global UI font (see globals.css font-family); the system stack is
 * the fallback if the CDN is unreachable.
 */
function ensureNunitoFont(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("kanban-nunito-font")) return;
  const link = document.createElement("link");
  link.id = "kanban-nunito-font";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap";
  document.head.appendChild(link);
}

/**
 * Activate the Kanban Board extension.
 *
 * Called by Agent Canvas with the host API object. Returns a cleanup function
 * that should be called when the extension is deactivated.
 */
export function activate(host: Host): () => void {
  let root: Root | null = null;

  ensureNunitoFont();

  const unregisterPage = host.registerPage("board", (ctx) => {
    // Mount under a dedicated root id so every scoped rule (Tailwind utilities
    // and the design-system CSS) applies only inside the extension and never
    // leaks into the host application.
    ctx.container.id = "kanban-extension-root";
    root = createRoot(ctx.container);
    root.render(<KanbanBoard host={host} />);
  });

  return () => {
    if (root) {
      root.unmount();
      root = null;
    }
    unregisterPage();
  };
}
