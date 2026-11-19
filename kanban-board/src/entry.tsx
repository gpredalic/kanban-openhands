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
 * Activate the Kanban Board extension.
 *
 * Called by Agent Canvas with the host API object. Returns a cleanup function
 * that should be called when the extension is deactivated.
 */
export function activate(host: Host): () => void {
  let root: Root | null = null;

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
