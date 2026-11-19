/**
 * entry.ts — extension entrypoint (spec §2, §5).
 *
 * The `activate(host)` function is called by Agent Canvas when the extension
 * is loaded. It:
 *   1. Injects the board stylesheet.
 *   2. Registers the "board" page, which renders the full Kanban board.
 *   3. Returns a cleanup function that unregisters the page and removes styles.
 *
 * The board itself (state store, data controller, columns, task cards) is
 * wired up by `renderBoard` in board.ts — this file is the thin glue between
 * the host API and the board component.
 */

import { renderBoard } from "./board";
import { injectStyles } from "./styles";
import type { Host } from "./types";

/**
 * Activate the Kanban Board extension.
 *
 * Called by Agent Canvas with the host API object. Returns a cleanup function
 * that should be called when the extension is deactivated.
 */
export function activate(host: Host): () => void {
  // Inject the board stylesheet (returns a cleanup that removes the <style> tag).
  const removeStyles = injectStyles();

  // Track the board's cleanup so we can tear it down on deactivation.
  let boardCleanup: (() => void) | null = null;

  // Register the "board" page. The render function is called by Agent Canvas
  // when the user navigates to the page. It calls renderBoard, which owns the
  // state store, data controller, and all column/task-card rendering.
  const unregisterPage = host.registerPage("board", (ctx) => {
    boardCleanup = renderBoard(host, ctx);
  });

  // Return the deactivation cleanup.
  return () => {
    if (boardCleanup) {
      boardCleanup();
      boardCleanup = null;
    }
    unregisterPage();
    removeStyles();
  };
}
