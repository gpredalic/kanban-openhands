/**
 * styles.ts — injects the board CSS into the page (spec §6).
 *
 * The CSS is embedded as a string so the bundle remains a single self-contained
 * ESM file with no external stylesheet to load. A <style> tag is injected on
 * mount and removed on cleanup.
 */

export const BOARD_CSS = `
.kb-board {
  --kb-bg: #0f1117;
  --kb-surface: #1a1d27;
  --kb-surface-2: #232734;
  --kb-border: #2e3340;
  --kb-text: #e6e8ee;
  --kb-text-dim: #9aa0b0;
  --kb-accent: #6c8cff;
  --kb-danger: #ff6b6b;
  --kb-radius: 8px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--kb-text);
  background: var(--kb-bg);
  padding: 16px;
  box-sizing: border-box;
  min-height: 100%;
}
.kb-board *,
.kb-board *::before,
.kb-board *::after {
  box-sizing: border-box;
}
.kb-board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.kb-board-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
.kb-board-filters {
  display: flex;
  gap: 6px;
}
.kb-filter-btn {
  background: var(--kb-surface);
  color: var(--kb-text-dim);
  border: 1px solid var(--kb-border);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.kb-filter-btn:hover {
  color: var(--kb-text);
  border-color: var(--kb-accent);
}
.kb-filter-btn.kb-active {
  background: var(--kb-accent);
  color: #fff;
  border-color: var(--kb-accent);
}
.kb-board-columns {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 8px;
}
.kb-column {
  flex: 0 0 280px;
  background: var(--kb-surface);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.kb-column.kb-drop-target {
  border-color: var(--kb-accent);
  box-shadow: 0 0 0 2px rgba(108, 140, 255, 0.25);
}
.kb-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kb-column-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--kb-text);
}
.kb-column-count {
  background: var(--kb-surface-2);
  color: var(--kb-text-dim);
  border-radius: 999px;
  font-size: 0.75rem;
  padding: 2px 8px;
  min-width: 22px;
  text-align: center;
}
.kb-column-tasks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 24px;
}
.kb-task-card {
  background: var(--kb-surface-2);
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  padding: 10px;
  cursor: grab;
  transition: border-color 0.15s, transform 0.1s, opacity 0.15s;
}
.kb-task-card:hover {
  border-color: var(--kb-accent);
}
.kb-task-card.kb-dragging {
  opacity: 0.5;
  cursor: grabbing;
}
.kb-task-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--kb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kb-task-meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 0.72rem;
  color: var(--kb-text-dim);
}
.kb-task-assignee {
  background: var(--kb-surface);
  border-radius: 4px;
  padding: 1px 6px;
}
.kb-task-blocked {
  color: var(--kb-danger);
  font-weight: 600;
}
.kb-task-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.kb-task-delete {
  background: transparent;
  border: none;
  color: var(--kb-text-dim);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.kb-task-delete:hover {
  color: var(--kb-danger);
  background: rgba(255, 107, 107, 0.12);
}
.kb-column-add {
  margin-top: auto;
}
.kb-column-add-input {
  width: 100%;
  background: var(--kb-surface-2);
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  color: var(--kb-text);
  font-size: 0.8rem;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.15s;
}
.kb-column-add-input::placeholder {
  color: var(--kb-text-dim);
}
.kb-column-add-input:focus {
  border-color: var(--kb-accent);
}
@media (max-width: 640px) {
  .kb-board-columns {
    flex-direction: column;
    align-items: stretch;
  }
  .kb-column {
    flex: 1 1 auto;
    width: 100%;
  }
}
`;

/**
 * Inject the board stylesheet into the document head.
 * Returns a cleanup function that removes the injected <style> tag.
 */
export function injectStyles(): () => void {
  const style = document.createElement("style");
  style.className = "kb-board-styles";
  style.textContent = BOARD_CSS;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}
