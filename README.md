# Kanban Board — Agent Canvas Extension

A Kanban board that runs **inside Agent Canvas** as a Canvas Extension. It is a
React + TypeScript + Tailwind app that bundles to a single self-contained
`extension.js`, which Agent Canvas loads in the same browser context and drives
through `activate(host)`. The board is a *view* onto a real data plane: tasks
persist to the agent-server file API, and OpenHands conversations are synced
both directions.

This is not a standalone web app. It has no server of its own — it talks to the
host over `host.agentServer.request(...)` and never constructs backend URLs or
holds credentials.

---

## What it does

- **Board** — four columns (`todo`, `in_progress`, `review`, `done`) with
  drag-and-drop (dnd-kit), WIP limits, per-project swimlanes, and live stats.
- **Task CRUD** — create, edit, delete, and move tasks. Every mutation persists
  to `board.json` on the agent server.
- **Search & filter** — real client-side filtering of the loaded task list.
- **Status & priority badges** — every status (`pending`, `queued`, `running`,
  `completed`, `failed`, `cancelled`) and priority (`low`, `medium`, `high`,
  `critical`) renders as a colored dot + Title Case label, vertically centered
  via flex. All render sites resolve through the shared `src/lib/badges.tsx`
  module, so the pattern is identical on cards, the detail modal, the create
  modal, execution history, and the workflow view, in both light and dark mode.
- **OpenHands integration** — board tasks link to OpenHands conversations via
  lowercase-alphanumeric tags (`taskid`, `agentid`, `boardstatus`, …). Inbound
  conversations appear on the board; board actions create/update conversations.
- **AI orchestration** — Run AI, multi-agent relay, agent assignment, and
  routing rules (see the audit notes for what is fully wired vs. partial).
- **Views** — Board, Command Center, Workflow, Agents, History, Analytics.
- **Column-move animation** — when a task's status changes and the card moves
  between columns, the card lifts (scale 1.02 + accent glow), glides across the
  board, and settles into its destination column (scale back to 1, shadow
  normalizes). The destination column pulses with a soft border glow and
  background tint that fade out. The accent color is status-aware: done →
  green, review → amber, in_progress → blue, todo/other → indigo. Implemented
  with the FLIP technique (no Framer Motion dependency).

---

## Project structure

```
.
├── README.md                     ← this file
├── specs/
│   └── kanban-canvas-extension-architecture.md   ← full architecture spec
├── .openhands/memory/            ← agent working memory (gitignored)
└── kanban-board/                 ← the extension (npm package root)
    ├── canvas-extension.json     ← manifest: name, entrypoint, contributed page
    ├── extension.js              ← BUILT artifact Agent Canvas loads (do not hand-edit)
    ├── package.json              ← scripts: build / typecheck / test
    ├── vite.config.ts            ← Vite lib-mode build → single extension.js
    ├── tailwind.config.js        ← scoped utilities (#kanban-extension-root), no Preflight
    ├── postcss.config.js
    ├── tsconfig.json
    ├── inline-css-plugin.ts      ← folds emitted CSS into the JS as a <style>
    ├── icons/                    ← extension icons + preview.html
    ├── src/
    │   ├── entry.tsx             ← activate(host): registers the "board" page, mounts React
    │   ├── components/           ← React UI (KanbanBoard, TaskCard, modals, views, …)
    │   ├── hooks/                ← useBoardState, useDragDrop, useFlipAnimation
    │   ├── lib/                  ← data layer (the real behavior lives here)
    │   │   ├── task-store.ts     ← task CRUD via the agent-server file API
    │   │   ├── use-board-data.ts ← fetch/group/reconcile controller + 15s poll
    │   │   ├── board-state.ts    ← column grouping, stats, WIP limits
    │   │   ├── openhands.ts      ← OpenHands sync, relay, execution, deleteConversation
    │   │   ├── ai-engine.ts      ← routing resolution, workflow DAG layout
    │   │   ├── ai-store.ts       ← AI state hook
    │   │   ├── workflow-store.ts ← workflow persistence (workflows.json)
    │   │   ├── task-overlay.ts   ← ephemeral tags/due-date overlay (localStorage)
    │   │   ├── badges.tsx        ← shared status/priority badge resolvers (dot + Title Case)
    │   │   ├── import-export.ts  ← board JSON export/import
    │   │   └── date.ts           ← date parsing/formatting
    │   ├── styles/globals.css    ← the real stylesheet (scoped to the root id)
    │   └── types/                ← task.ts, openhands.ts, ai.ts
    ├── test/                     ← headless tests (node:test + happy-dom)
    │   ├── render.test.ts        ← mounts the REAL extension.js, inspects the DOM
    │   ├── acceptance.test.ts    ← user-click acceptance sweep
    │   ├── audit.test.ts         ← audit-driven DOM assertions
    │   ├── probe-delete.test.ts  ← delete-task acceptance probe
    │   ├── probe-live.test.ts    ← live agent-profile assignment probe
    │   ├── workflow-persist.test.ts
    │   ├── task-store.test.ts    ← file-API response-shape handling
    │   ├── board-state.test.ts, date.test.ts, openhands.test.ts
    │   ├── setup.ts              ← happy-dom globals (must import first)
    │   ├── register.mjs          ← ESM resolve hook (extensionless .ts imports)
    │   └── ts-loader.mjs
    ├── harness/                  ← live user-simulation harness
    │   ├── server.mjs            ← static server (port 8090) that injects the session token
    │   └── index.html            ← mounts the real extension.js against the live agent server
    └── docs/audit/               ← user-acceptance audit artifacts (briefs, reports, logs)
```

---

## Build, typecheck, test

All commands run from `kanban-board/`.

```bash
npm install
npm run build       # Vite → dist/extension.js, moved to ./extension.js
npm run typecheck   # tsc --noEmit
npm test            # node --import ./test/register.mjs --test --test-force-exit test/*.test.ts
```

The build produces **one** file, `extension.js`, at the package root — the exact
artifact declared in `canvas-extension.json` and the one the render/acceptance
tests import. `inlineDynamicImports` folds React, dnd-kit, and every component
into that single chunk; `inline-css-plugin.ts` folds the CSS in as a `<style>`
so there are no external runtime chunks or bare imports.

### Running the live harness

The harness serves the real `extension.js` and talks to the **live** agent
server (default `http://localhost:18000`) with a session token injected at
serve time. This is the closest thing to clicking the UI in a real browser.

```bash
cd kanban-board
SESSION_TOKEN="$OPENHANDS_AUTOMATION_API_KEY" PORT=8090 node harness/server.mjs
# then open http://localhost:8090/
```

---

## How it works (the data plane)

- **Persistence** — `task-store.ts` reads/writes a single JSON file at
  `/home/razvijalec/.kanban-board/board.json` through the agent-server file API
  (`GET /api/file/download`, `POST /api/file/upload`). The download returns
  `application/octet-stream`, so the host hands back a raw string that
  `fetchTasks` parses into a task list.
- **Reconciliation** — `use-board-data.ts` owns a 15-second poll that re-fetches
  and reconciles with the live backend. Every mutation is optimistic in the UI,
  then persisted and re-fetched.
- **Status → column mapping** — OpenHands is the source of truth for execution
  status; the board column is a projection of it. The contract is defined once
  in `executionStatusToColumn()` (`openhands.ts`) and read by every surface that
  derives a column from an execution status (`recordExecution`,
  `statusForConversation`, the inbound reconcile):
  `queued`/`pending` → `todo`, `running`/`executing`/`started` → `in_progress`,
  `failed`/`error` → `review`, `cancelled`/`stopped` → `review`,
  `completed` → `done`. A user-set `boardstatus` tag (drag-and-drop) is
  authoritative and overrides the mapping.
- **Duplicate-id guard** — a task id must appear at most once on the board; a
  duplicate id renders the same card in two columns. `dedupeTasks()`
  (`task-store.ts`) collapses duplicates by id (preferring the entry linked to a
  live conversation) and is applied both in the inbound reconcile (which also
  cleans the board file on the next save) and in `load()` as defense in depth.
- **OpenHands sync** — `openhands.ts` maps board tasks to conversations using
  lowercase-alphanumeric tag keys (the agent server rejects underscores in tag
  keys). `syncInboundConversations` surfaces live conversations on the board;
  `syncBoardAction` mirrors board actions back; `deleteConversation` removes a
  conversation by id so a deleted task does not resurrect on the next poll.
- **Host isolation** — every Tailwind utility is emitted under
  `#kanban-extension-root` and Preflight is disabled, so the bundle never
  restyles the host application.

---

## Current status (user-acceptance audit)

The extension was audited by exercising the real `extension.js` through the
headless render harness and the live harness. **No feature is fully broken**,
but six are **partially working** and keep it short of the enterprise bar:

| Feature | Status |
|---|---|
| Create / Edit / Delete / Move Task | WORKS |
| Persistence after refresh | WORKS |
| Search | WORKS |
| Command Center, Workflow, Agents views | WORKS |
| OpenHands → Board and Board → OpenHands sync | WORKS |
| Multi-agent relay | WORKS |
| **Notifications** | PARTIALLY — local in-memory panel only; no durable feed, read state, or deep links |
| **Run AI** | PARTIALLY — starts a conversation and shows an active run, but no completed result/output is surfaced |
| **History View** | PARTIALLY — active runs render; completed history is not durably retained |
| **Analytics View** | PARTIALLY — renders, but shows `Unavailable` totals when the server reports no metrics |
| **Agent assignment** | PARTIALLY — persists, but the assigned agent is not reliably shown on cards/detail |
| **AI routing** | PARTIALLY — can trigger a conversation, but the routing decision is not visible to the user |

Full evidence, root causes, affected files, and the exact work required for each
partial item are in `kanban-board/docs/audit/AUDIT_REPORT.md` (and the Copilot
audit logs alongside it).

---

## Known gotchas

- **Extensionless imports** — source uses bundler-style `import ... from "./x"`
  with no extension. Node's native type-stripping can't resolve those, so tests
  run through the `test/register.mjs` resolve hook (which appends `.ts`).
- **`process.env.NODE_ENV`** — Vite lib mode does not auto-replace it, so the
  build pins it to `"production"` or the bundle throws `process is not defined`
  in the browser.
- **Node test runner vs. `FormData`/`Blob`** — the file-API write path
  (`saveTasks`) uses `FormData`/`Blob`, which the Node runner's undici rejects.
  That is a test-environment limitation, not a production bug (the browser has
  native `Blob`/`FormData`). It is why a couple of `commandExecution` tests fail
  under `node --test` but the real UI works.
- **Terminal CWD** — the shell resets to `kanban-board/` between commands; `cd`
  to the git root explicitly for git operations.
