# Kanban Board — User Acceptance Audit

Method: rebuilt the real `extension.js` with `npm run build`, mounted that exact artifact with `activate(host)`, and drove the DOM through the headless render harness. The mock host exercised the real file and OpenHands request surfaces and exposed the resulting DOM text, element counts, clicks, persisted task state, and remount behavior.

## 18-feature classification

| # | Feature | Classification | Concrete observed DOM evidence |
|---|---|---|---|
| 1 | Create Task | **WORKS** | Clicking **Create Task** rendered `input[placeholder="What needs to be done?"]`; entering `Persisted audit task` and clicking **Create** made the title visible and persisted it in the host task list; a separate acceptance run rendered `Acceptance created task` and found it in the host file. |
| 2 | Edit Task | **WORKS** | Clicking **Edit task** opened **Edit Task**. Saving `Acceptance edited task` made it visible in the board and present in the persisted task list. |
| 3 | Delete Task | **WORKS** | The card **Delete task** button removed `Acceptance edited task` from the persisted task list. The detail-modal path also opened **Confirm Delete** and removed the selected task. |
| 4 | Move Task between columns | **WORKS** | A drag-style pointer sequence moved `Acceptance created task` to `in_progress` in the host task state; DOM query `[data-drop-status='in_progress']` contained that title, and the status remained `in_progress` after remount. |
| 5 | Persistence after page refresh | **WORKS** | After cleanup/remount, the reload DOM contained `Acceptance created task`, `Inline add task`, the edited title, and the moved task in its In Progress state. The host task file contained 8 tasks, including the moved status. |
| 6 | Search | **WORKS** | Searching for `Acceptance created` showed `Acceptance created task` and hid `Design the onboarding flow`; the harness observed both the match-visible and non-match-hidden state. |
| 7 | Notifications | **PARTIALLY WORKS** | The bell button changed `data-notifications-open` to `true` and a first pass changed the DOM with a notification list. One notification was not meaningful, though: after switching to Analytics and clicking the bell again, the `aria-label="Notification surface"` panel was absent and the visible page contained only analytics text; there is no read/clear/deep-link interaction in the observed panel behavior. |
| 8 | Run AI | **PARTIALLY WORKS** | `Run AI` changed to a pressed **Stop AI** state and the harness observed 2 OpenHands conversation POSTs. **History** then showed `Execution History — 1 active — 0 completed` and `Persisted audit task`, proving an active execution in the mock. No live result/output appeared on the board itself, and the run remained active rather than producing an obvious completed answer in the observed DOM. |
| 9 | Command Center | **WORKS** | Clicking **Command Center** rendered `OpenHands Command Center`, `Live operations, execution control, and activity from OpenHands`, live metric labels, and a live `Last synced`/`Not synced yet` indicator. |
| 10 | Workflow View | **WORKS** | Clicking **Workflow** rendered workflow UI, including `Create workflow`, `Feature Pipeline`, `Research → implement → review → ship`, and the edit/delete controls in the acceptance DOM. |
| 11 | Agents View | **WORKS** | Clicking **Agents** rendered `Orchestration Configuration` with visible text for `5 agents · 2 teams · 4 routing rules · 5 models`, plus the `Agent Roster`, `Scout`, and roster/configuration controls. |
| 12 | History View | **WORKS** | Clicking **History** rendered `Execution History`, `1 active · 0 completed`, `Active Runs`, and the run title `Persisted audit task` with conversation ID `conversation-1`. |
| 13 | Analytics View | **PARTIALLY WORKS** | The view rendered, but after an active execution it showed `Total Tokens InUnavailable`, `Total Tokens OutUnavailable`, `Total CostUnavailable`, `Runs Completed0`, and `unknown0 in · 0 out · $0.00 · 1 runs`. The page therefore displays a run but not usable totals or accurate completion metrics. |
| 14 | OpenHands -> Board synchronization | **WORKS** | Adding an inbound mock conversation titled `OpenHands inbound conversation` made it appear in the Command Center within the 4-second harness wait. A separate reload test found `OpenHands acceptance conversation` in the remounted DOM. |
| 15 | Board -> OpenHands synchronization | **WORKS** | Creating and moving tasks caused file uploads and board actions posted OpenHands conversations. In the acceptance sweep, stopping and restarting AI increased `/api/conversations` POST count and the board/outbound action produced a new conversation. |
| 16 | Multi-agent relay | **WORKS** | Entering `Acceptance relay seed`, adding Scout to the chain, and starting relay made `Relay response from mock agent` appear in the relay hop DOM; the harness observed 1 `/ask_agent` POST and 3 conversation POSTs across the sweep. |
| 17 | Agent assignment | **WORKS** | In the acceptance sweep, opening the created task's edit modal exposed `select[aria-label="AI agent"]`; a real profile option was selectable, `Assigned agent:` appeared in the detail state, and the acceptance assertions retained that assignment through Save/reload. |
| 18 | AI routing | **WORKS** | The harness observed Run AI/board orchestration POSTing to `/api/conversations`; task creation also returned a real-shaped conversation ID and the selected agent/profile path was exercised by the assignment and relay controls. |

## PARTIALLY WORKS items

### 7. Notifications

- **Root cause:** The notification system is a local state panel fed by task/AI events, with no persistent read state, clear/dismiss action, event details navigation, or server-backed notification feed. The observed toggle could be opened and closed, but after view changes the harness observed no notification surface and no actionable message handling.
- **Affected files:** `src/components/Header.tsx`, `src/components/KanbanBoard.tsx`.
- **Implementation status:** Partially implemented: the bell opens/closes a panel and can display a short in-memory list.
- **Exact work required:** Add persistent notification records and unread/read state; mark items read on open or explicit action; add clear-all and per-item dismiss; provide click-through to the task, conversation, execution, or failure; show loading/error states and timestamps; and add tests that open, navigate, read, dismiss, and persist notifications across remount.

### 8. Run AI

- **Root cause:** The state-driven button and execution snapshot prove that a conversation was started, but execution output is not rendered as a user-visible result and the mock snapshot reported no terminal answer/completion. The harness observed a running title in History, not an answer, logs, or final result.
- **Affected files:** `src/components/Header.tsx`, `src/components/KanbanBoard.tsx`, `src/components/ExecutionHistory.tsx`, `src/components/OpenHandsView.tsx`, `src/lib/openhands.ts`, `src/lib/ai-engine.ts`.
- **Implementation status:** Partially implemented: Run AI toggles an orchestration state and POSTs conversations, and History can show an active run.
- **Exact work required:** Implement a clear start/loading/running/completed/failed/stopped sequence with visible progress and a result summary; surface the conversation response or final event, execution logs, elapsed time, and retry/cancel controls; reconcile terminal status against OpenHands; disable stale duplicate starts; and verify in the harness that a real mocked completed response appears and changes History/Analytics to completed.

### 13. Analytics

- **Root cause:** Analytics only derives totals from fields reported by the OpenHands snapshot. The harness received no token or cost fields, so it rendered `Unavailable`, and the execution remained active with `Runs Completed0`. It has no fallback for missing server metrics and no accurate live completion aggregation.
- **Affected files:** `src/components/AnalyticsView.tsx`, `src/lib/openhands.ts`, `src/types/openhands.ts`, `src/lib/ai-engine.ts`.
- **Implementation status:** Partially implemented: the Analytics view and breakdown layout render, but usable usage/cost/completion data was absent.
- **Exact work required:** Normalize token, cost, and model/agent attribution fields from the actual OpenHands APIs; show explicit `not reported by server` only when unavailable; aggregate completed/failed/cancelled runs accurately; test active, completed, failed, missing-metrics, and malformed-metrics responses; and ensure values update after execution completion.
