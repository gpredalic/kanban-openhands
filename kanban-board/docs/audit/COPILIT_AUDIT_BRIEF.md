# Copilot Acceptance-Audit Brief (run via `copilot -p`)

You are verifying the REAL production workflow of the "kanban-board" Agent Canvas
extension. Judge what ACTUALLY happens when a user clicks the UI — not what the
code comments claim. Ground every claim in an observed HTTP response, a board.json
change, or a conversation state you fetched. Do NOT report build status, bundle
size, React architecture, Tailwind setup, or test counts.

## Environment (all live right now)
- Live harness: http://localhost:8090  (serves the built extension.js)
  - Read `harness/server.mjs` to see exactly how it proxies/authenticates to the
    agent server (it injects a session token). Reuse that same auth path.
- Real OpenHands agent server: http://127.0.0.1:18000
- Board persistence: /home/razvijalec/.kanban-board/board.json  (a JSON array of tasks)
- Source: src/  (React + Tailwind). Data layer that holds the real behavior:
  src/lib/task-store.ts, src/lib/use-board-data.ts, src/lib/openhands.ts,
  src/lib/ai-engine.ts, src/lib/ai-store.ts. Read these to learn the EXACT
  endpoints the UI calls, then reproduce those calls with curl.
- Known profile: qwen38-openhands -> id d83cb56e-2c6f-4566-9447-7cc253b68251

## Method
Drive the real workflow by making the SAME HTTP calls the UI makes (curl), against
the live services above. Inspect board.json before/after each action and poll the
agent server for conversation/execution state. Do NOT run the render harness
(test/render.test.ts). You have shell access — use curl, node, python3, git.

## Bug 1 scenario — verify end-to-end (this is the core check)
1. Create task titled "Replace vending machine cash reader".
2. Assign it to the qwen38-openhands profile.
3. Run AI on it.
4. Capture and report: the conversation id, the execution id, the assigned profile
   id, the task status transitions (todo -> in_progress -> ...), and the history
   entry that gets written. Confirm each against the live agent server and
   board.json, not against a mock.

## Classify ALL 18 features as WORKS / PARTIALLY WORKS / BROKEN
1. Create Task
2. Edit Task
3. Delete Task
4. Move Task between columns
5. Persistence after page refresh
6. Search
7. Notifications
8. Run AI
9. Command Center
10. Workflow View
11. Agents View
12. History View
13. Analytics View
14. OpenHands -> Board synchronization
15. Board -> OpenHands synchronization
16. Multi-agent relay
17. Agent assignment
18. AI routing

For every PARTIALLY WORKS or BROKEN item provide:
- root cause
- affected files
- implementation status
- exact work required to make it production-ready

## Success criteria (the user must be able to)
create tasks, edit tasks, save tasks, reload the page, still see tasks, search
tasks, run AI workflows, see executions, and see OpenHands activity reflected on
the board. The app must behave like a real enterprise product, not a UI demo.

## Output
Return the full 18-row classification table (WORKS / PARTIALLY WORKS / BROKEN per
feature), then for every non-WORKS item the root cause, affected files,
implementation status, and exact work required. Cite the concrete evidence
(curl response, board.json diff, conversation state) behind each row.
