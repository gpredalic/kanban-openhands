# Kanban Board — Canvas Extension Architecture Specification

> Scope: a **Canvas Extension** (Apps / Canvas Apps, Beta) that renders a
> Kanban board inside Agent Canvas. This is a *browser-only* app — it does not
> run agent tool calls, only a UI surface backed by data.
>
> Sources: OpenHands Canvas Extensions docs (`/usage/agent-canvas/canvas-extensions`),
> the Canvas Extensions API spec, and the `demo-page` fixture
> (`src/fixtures/canvas-extensions/demo-page`).

---

## 1. Extension architecture

The extension is a **self-contained browser ESM bundle** that Agent Canvas loads
in the *same* browser context (no iframe, no worker isolation). It is not part
of the Agent Server runtime; it is a pure presentation layer that talks to the
host over HTTP.

```
┌──────────────────────────────────────── Agent Canvas (browser) ────────────────────────────────────┐
│  Sidebar:  [ Kanban ]   ← app nav item (from manifest nav_label)                                    │
│                                                                                                      │
│  Route:    /extensions/kanban-board/  ← Canvas mounts the app at this path                         │
│             ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│             │  extension.js (host API 1)                                                           │   │
│             │    ├─ activate(host) → host.registerPage("board", renderFn)                         │   │
│             │    ├─ renderFn(container, { path }) → DOM board                                      │   │
│             │    └─ cleanup() → remove()                                                           │   │
│             └──────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  Host API surface (host injects):                                                                  │
│    host.apiVersion        = "1"                                                                    │
│    host.agentServer.request(...)  ← authenticated HTTP to backend                                  │
│    host.appBackendView.mount(...) ← optional bridge UI (if backend advertises it)                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲  HTTP (root-relative paths, single leading '/', no full URLs)
        │  POST /api/agent/tasks  GET /api/agent/tasks/{id}  PATCH ...  (host-supplied auth)
        ▼  Agent Server (host-owned backend)
```

**Key architectural decisions (inherited from the platform contract):**

- **Single bundle, no external runtime chunks.** All logic, CSS, and assets must
  be bundled into one ESM file. No dynamic `import()` of remote chunks, no
  service-worker split — unresolved/external imports fail.
- **Host-owned data plane.** The extension never constructs backend URLs, never
  derives an ingress origin, never holds a session key. All auth and origin
  construction is the host's responsibility.
- **Synchronous contract, async data.** The `activate`/`registerPage` surface is
  synchronous (returns a cleanup fn), but the render closure is free to `await`
  the host's `agentServer.request` helper.
- **Beta lifecycle.** Canvas may mount, dispose, and reload the app repeatedly
  (enable/disable, update, reconnect, backend switch). The extension must be
  fully disposable.

**Kanban-specific layering** (extends the platform contract):

- The board's *data* lives in the **host backend** (tasks, columns, statuses) —
  the same store the native board app uses. The extension is a *view* onto that
  store, not a competing data source.
- The extension adds **Kanban-specific UI state** (drag state, selected column,
  filter view) that is *ephemeral* and lives only in the browser — it is not
  persisted by the extension itself.

---

## 2. Manifest structure

Manifest schema **1**, host API **1**. One `canvas-extension.json` at the app
root; one ESM entrypoint inside that root.

```jsonc
{
  "schema_version": 1,
  "name": "kanban-board",                 // lowercase, digits, hyphens only
  "display_name": "Kanban Board",
  "version": "0.1.0",
  "description": "A Kanban board UI for Agent Canvas (tasks & columns).",
  "icon": "kanban.svg",                   // optional; served from /api/canvas-extensions/installed/{name}/icon
  "entrypoint": "extension.js",           // must stay inside app root
  "contributes": {
    "pages": [
      {
        "id": "board",
        "title": "Kanban Board",
        "path": "/kanban-board",          // unique within the app, starts with /
        "nav_label": "Kanban"
      }
    ]
  }
}
```

**Manifest invariants:**

| Field | Rule |
|-------|------|
| `name` | lowercase letters/digits/hyphens; unique app id |
| `path` | starts with `/`; unique per app |
| `id` | unique per app; must match the `registerPage` id |
| `icon` | optional; must be inside app root |
| `entrypoint` | single ESM file inside app root |
| Multiple pages | allowed; each needs a unique `id`/`path` |

**Registering pages** (from the entrypoint):

```js
export function activate(host) {
  if (host.apiVersion !== "1") {
    throw new Error("This extension requires host API 1.");
  }
  return host.registerPage("board", ({ container, path }) => { /* render */ });
}
```

The page `id` passed to `registerPage` **must match** a page declared in the
manifest. Return a cleanup function for every registration so Canvas can safely
disable/reload the app.

---

## 3. Component hierarchy

```
<KanbanBoard>  (mounted into the page container by registerPage)
├── <BoardState>            // ephemeral UI state (React-ish store or plain object)
│   ├── columns: [...]      // from backend tasks grouped by column/status
│   └── uiState: { drag, filter, selectedColumn }
│
├── <BoardHeader>
│   ├── columnFilter (dropdown / chips)
│   └── viewToggle (all / active / assigned)
│
├── <ColumnList>            // one <Column> per status (To Do → Done)
│   ├── <Column>
│   │   ├── header (title + count badge)
│   │   ├── <TaskCard> × N   // draggable; emits dragstart/drop events
│   │   └── add-task input
│   └── <Column>
│
└── <TaskCard>              // task row
    ├── title, assignee, status
    └── move handler → POST /api/agent/tasks/{id}  (reassign / update status)
```

**State ownership map:**

- **Persisted (host backend):** tasks, columns, statuses — the source of truth.
- **Ephemeral (browser only):** drag-in-flight, hover state, local filter,
  optimistic-move UI. Never persisted by the extension.
- **Host-provided:** `apiVersion`, `agentServer`, `appBackendView`, `backend.id`.

**Rendering model:** server-rendered HTML + minimal client hydration is acceptable
(the demo fixture is dependency-free DOM). A full SPA is optional and heavier.

---

## 4. Storage design

Two distinct layers — keep them separate:

### 4.1 Persistent data (host backend)

The extension does **not** own persistence. It reads/writes through the host's
authenticated agent-server API.

| Operation | HTTP | Purpose |
|----------|------|---------|
| List tasks | `GET /api/agent/tasks` | Load board |
| Move task | `POST /api/agent/tasks/{id}` | Reassign / change status |
| Update task | `PATCH /api/agent/tasks/{id}` | Edit title/assignee |
| Delete task | `DELETE /api/agent/tasks/{id}` | Remove |

**Backend data model (tasks):**

```
task = {
  id: string,
  title: string,
  status: "todo" | "in_progress" | "review" | "done",  // maps to columns
  assignee: string | null,
  projectId: string,
  waitingOn: id[] | null,   // inherited from native Task model (blocked flag)
}
```

**Columns = statuses.** The board renders one column per status value. This
mirrors the native `Task.status` enum — no duplicate status vocabulary.

### 4.2 Ephemeral UI state (browser only)

```
localStorage / in-memory store:
{
  kanbanBoard: {
    uiState: {
      filter: "all" | "active" | "assigned",
      selectedColumn: string | null,
      lastLoadedAt: number
    }
  }
}
```

**Rules:**

- Only the **UI filter** and **last-loaded timestamp** are cached locally.
- **Never** cache task/tasklist data — always re-fetch from the host so the
  board reflects the live backend (and picks up changes from the native board).
- No secrets, no credentials in browser storage.

### 4.3 Data flow

```
Mount → fetch GET /api/agent/tasks → group by status → render columns
   ↓ (drag or move)
POST /api/agent/tasks/{id} → optimistic UI update → await response → re-fetch
   ↓ (poll)
Periodic GET to reconcile with live backend (native board edits included)
```

---

## 5. OpenHands integration strategy

### 5.1 Host API surface (injectable)

```js
const host = {
  apiVersion: "1",
  agentServer: {
    request: ({ method, path, body }) =>
      fetch("/api/agent/tasks", { method, body, signal })   // root-relative, host sets Origin/auth
  },
  appBackendView: { mount: ({ container }) => ({ unmount }) }  // optional
};
```

- **`host.agentServer.request`** — the *only* way to reach the backend. Paths are
  root-relative, begin with exactly one `/`, and must not be full URLs. Do **not**
  derive backend URLs or credentials from Canvas internals.
- **`host.appBackendView`** — optional; present only when the active backend
  advertises the bridge contract (`server_info` bridge capability + ingress URL,
  plus `@openhands/typescript-client` exports). A Kanban board typically does
  **not** need it — it is a fallback for embedding a backend-owned UI.
- **`host.backend.id`** — available for display/debugging.

### 5.2 Mounting & routing

- Canvas mounts the app at `/extensions/kanban-board/` (derived from
  `name` + page `path`). A nested route `/extensions/kanban-board/services`
  passes `services` as the relative `path`.
- The extension registers the page by matching `id`.

### 5.3 Auth & security model

- **Same browser context** — apps are **not** isolated in an iframe/worker and
  no fine-grained permissions are enforced. The extension has the full browser
  authority of Agent Canvas.
- **Sandboxed HTTP:** Canvas validates that any URL the extension requests shares
  the ingress origin and applies only server-provided sandbox tokens; it rejects
  top-navigation, downloads, and storage access.
- **Trust model:** enable only apps whose code and resolved revision you trust.
  Treat the extension bundle as untrusted code.

### 5.4 Lifecycle hooks

- `activate` runs on mount; return cleanup fns for every registration.
- On **disable / update / reconnect / backend switch**, Canvas disposes the app:
  remove all DOM nodes, styles, timers, listeners, observers, and subscriptions.
- Handle loading / empty / malformed / error states; remain keyboard-accessible
  and usable on narrow screens.

### 5.5 Beta constraints (do not rely on)

- No conversation tabs, arbitrary interface slots, themes, visualizer
  replacement, or direct Agent Server WebSocket connections.
- No host origin / WebSocket-auth exposure — poll or use a backend-owned bridge
  instead.

---

## 6. File structure

```
kanban-board/                      # app root (installed as one package)
├── canvas-extension.json          # manifest (schema 1)
├── extension.js                   # self-contained ESM entrypoint (activate)
├── index.html                    # (optional) shell; not required if JS-only
├── src/
│   ├── board.ts                  # <KanbanBoard> component
│   ├── board-state.ts            # ephemeral UI state store
│   ├── column.ts                 # <Column> component
│   ├── task-card.ts              # <TaskCard> + drag handlers
│   ├── use-board-data.ts         # fetch/group/reconcile logic
│   └── types.ts                  # Task, Column, Status unions
├── styles/
│   └── board.css                 # scoped styles (app-specific root)
├── assets/
│   ├── kanban.svg                # icon (optional)
│   └── task-icons.svg
├── tsconfig.json                # (optional) build config
├── package.json                 # (optional) bundler config
└── README.md                    # (optional)
```

**Build output:** bundle everything into `extension.js` (single ESM file). No
external runtime chunks, no unresolved imports.

**On-disk layout during install** (Agent Server copies source → bundle):

```
<backend>/canvas-extensions/installed/kanban-board/extension.js   # served bundle
```

---

## 7. Testing plan

### 7.1 Unit (headless)

- Manifest validation: `schema_version=1`, unique `id`/`path`, entrypoint resolves.
- `activate` throws on `apiVersion !== "1"`.
- State store: filter, drag, optimistic move, reconcile.
- Component rendering: columns render per status; cards render per task.

### 7.2 Integration (MSW dev mode, per `docs/CANVAS_EXTENSIONS_TESTING.md`)

```sh
VITE_FRONTEND_PORT=3102 \
VITE_BACKEND_BASE_URL=http://127.0.0.1:8000 \
VITE_SESSION_API_KEY=canvas-extension-dev \
npm run dev:mock
```

- Open `http://localhost:3102/apps` (not the `:8000` ingress — its `/api` goes
  straight to the unmodified Agent Server).
- Install + enable `kanban-board`; confirm nav item + route appear.
- Mock `agentServer.request` to return tasks; confirm board renders columns.
- Simulate move → assert `POST /api/agent/tasks/{id}` shape.

### 7.3 E2E (real backend)

- Enable app against a real Agent Server backend.
- Load board → assert columns match backend statuses.
- Drag a task → assert backend task status changes; reconcile.
- Disable app → assert cleanup removes DOM, timers, listeners.

### 7.4 Beta-lifecycle tests

- Enable/disable, update, reconnect, backend switch → app disposes cleanly.
- Nested route (`/extensions/kanban-board/...`) passes relative path.
- Narrow-screen + keyboard accessibility.

---

## 8. Security risks

| Risk | Mitigation |
|------|-----------|
| Untrusted bundle executing in same context | Enable only trusted, reviewed source + resolved revision |
| Path traversal / full-URL requests | Host validates root-relative, single-slash, no full URLs |
| Origin confusion | Canvas validates shared ingress origin; rejects top-nav/downloads |
| State leakage to native board | Ephemeral UI state only; data always re-fetched from backend |
| Stale data | Poll/re-fetch; never trust cached task data |
| No isolation | Accept — treat as trusted; no fine-grained perms in beta |

---

## 9. Deployment recommendation

- **Package as a single directory** (`kanban-board/`) containing the manifest and
  a self-contained `extension.js`. Ship pre-bundled; no build step at runtime.
- **Install via Agent Server** (Git Repository or backend-local path), then
  **enable** (accept trusted-code notice). Each backend has its own installed
  apps, files, versions, and enabled states.
- **Data source:** point the board at the same task store the native board uses
  (via `host.agentServer.request`). No separate backend or database.
- **No Cloud dependency:** apps run on the local backend; they are unavailable
  with an OpenHands Cloud backend active.
- **Update in place:** re-resolve source and copy over without uninstall.
