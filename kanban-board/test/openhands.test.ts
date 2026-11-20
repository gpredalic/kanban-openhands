import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Host } from "../src/types/task";
import {
  OpenHandsStateStore,
  normalizeSnapshot,
  buildRelayConversationRequest,
  buildSwitchProfileRequest,
  buildAskAgentRequest,
  buildChildConversationRequest,
  buildConversationRequest,
  relayHopQuestion,
  getAgentProfileId,
  fetchAgentProfiles,
  fetchOpenHandsSnapshot,
  commandExecution,
  syncBoardAction,
  startAgentRelay,
} from "../src/lib/openhands";

function hostWith(request: (opts: { method: string; path: string; body?: unknown }) => Promise<unknown>): Host {
  return {
    apiVersion: "1",
    registerPage: () => () => undefined,
    agentServer: { request },
  };
}

test("normalizeSnapshot parses real conversation search responses and metrics", () => {
  const snapshot = normalizeSnapshot({
    items: [{
      id: "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe",
      title: "Fix kanban sync",
      execution_status: "running",
      created_at: "2026-11-19T09:55:40.103414",
      updated_at: "2026-11-19T10:00:00Z",
      current_model_id: "qwen",
      tags: { taskid: "task-1", agentprofileid: "profile-1" },
      stats: {
        usage_to_metrics: {
          default: {
            accumulated_cost: 1.25,
            accumulated_token_usage: { prompt_tokens: 100, completion_tokens: 25 },
          },
        },
      },
    }],
  });
  assert.equal(snapshot.executions.length, 1);
  const run = snapshot.executions[0];
  assert.equal(run.id, "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe");
  assert.equal(run.taskId, "task-1");
  assert.equal(run.agentId, "profile-1");
  assert.equal(run.status, "running");
  assert.equal(run.tokensIn, 100);
  assert.equal(run.tokensOut, 25);
  assert.equal(run.cost, 1.25);
  assert.equal(snapshot.links.length, 2);
});

test("normalizeSnapshot handles all statuses and defensive malformed input", () => {
  assert.deepEqual(normalizeSnapshot(null).executions, []);
  assert.deepEqual(normalizeSnapshot({ items: "bad" }).executions, []);
  for (const [source, status] of [
    ["finished", "completed"],
    ["error", "failed"],
    ["deleting", "cancelled"],
    ["paused", "queued"],
  ] as const) {
    const run = normalizeSnapshot({ items: [{ id: "x", execution_status: source }] }).executions[0];
    assert.equal(run.status, status);
  }
});

test("conversation and relay command builders match OpenHands request schemas", () => {
  assert.deepEqual(buildRelayConversationRequest("seed", "/repo", "profile-id"), {
    workspace: { working_dir: "/repo", kind: "LocalWorkspace" },
    initial_message: { role: "user", content: [{ type: "text", text: "seed" }], run: false },
    autotitle: true,
    tags: { relay: "true" },
    agent_profile_id: "profile-id",
  });
  assert.deepEqual(buildSwitchProfileRequest("qwen38-openhands"), { profile_name: "qwen38-openhands" });
  assert.deepEqual(buildAskAgentRequest("question"), { question: "question" });
  assert.deepEqual(buildChildConversationRequest("brief"), { task: "brief" });
  const conversation = buildConversationRequest({
    taskId: "task-1",
    title: "Implement",
    description: "Details",
    workspaceId: "/repo",
  });
  assert.deepEqual(conversation.workspace, { working_dir: "/repo", kind: "LocalWorkspace" });
  assert.deepEqual(conversation.initial_message, {
    role: "user",
    content: [{ type: "text", text: "Implement\n\nDetails" }],
    run: false,
  });
  assert.deepEqual(conversation.tags, { taskid: "task-1", tasktitle: "Implement" });
});

test("relay hop question carries the prior answer forward", () => {
  assert.equal(relayHopQuestion("seed", 0), "seed");
  assert.equal(relayHopQuestion("answer", 1), "answer");
});

test("getAgentProfileId resolves name, id, active profile, and UUID fallback", async () => {
  const calls: unknown[] = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return {
      profiles: [
        { id: "11111111-1111-1111-1111-111111111111", name: "default" },
        { id: "22222222-2222-2222-2222-222222222222", name: "qwen" },
      ],
      active_agent_profile_id: "22222222-2222-2222-2222-222222222222",
    };
  });
  assert.equal(await getAgentProfileId(host, "qwen"), "22222222-2222-2222-2222-222222222222");
  assert.equal(await getAgentProfileId(host, "11111111-1111-1111-1111-111111111111"), "11111111-1111-1111-1111-111111111111");
  assert.equal(await getAgentProfileId(host, "missing"), "22222222-2222-2222-2222-222222222222");
  assert.equal(calls.length, 3);
});

test("fetchAgentProfiles maps the real profile response and rejects malformed profiles", async () => {
  const host = hostWith(async () => ({
    profiles: [
      { id: "11111111-1111-1111-1111-111111111111", name: "default" },
      { id: null, name: "missing-id" },
      { name: null },
    ],
  }));
  assert.deepEqual(await fetchAgentProfiles(host), [
    { id: "11111111-1111-1111-1111-111111111111", name: "default" },
    { id: "missing-id", name: "missing-id" },
  ]);
});

test("fetchOpenHandsSnapshot uses search and event search with real response shapes", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const conversationId = "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe";
  const host = hostWith(async (opts) => {
    calls.push(opts);
    if (opts.path.startsWith("/api/conversations/search")) {
      return { items: [{ id: conversationId, title: "Live", execution_status: "running", tags: { taskid: "task-1" }, created_at: "2026-11-19T09:55:40Z" }] };
    }
    if (opts.path.includes("/events/search")) {
      return { items: [{ id: "event-1", kind: "ActionEvent", timestamp: "2026-11-19T10:00:00Z", action: "terminal" }] };
    }
    return {};
  });
  const snapshot = await fetchOpenHandsSnapshot(host);
  assert.equal(snapshot.executions.length, 1);
  assert.equal(snapshot.executions[0].status, "running");
  assert.ok(snapshot.events.some((event) => event.id === "event-1"));
  assert.ok(calls.some((call) => call.path === "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC"));
  assert.ok(calls.some((call) => call.path.includes(`/api/conversations/${conversationId}/events/search?`)));
});

test("commandExecution start creates and runs a correctly shaped conversation", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    if (opts.path === "/api/agent-profiles") return { profiles: [{ id: "11111111-1111-1111-1111-111111111111", name: "default" }], active_agent_profile_id: "11111111-1111-1111-1111-111111111111" };
    if (opts.path === "/api/conversations") return { id: "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe" };
    return {};
  });
  await commandExecution(host, "start", { taskId: "task-1", title: "Implement", agentId: "default" });
  assert.equal(calls.some((call) => call.path === "/api/conversations" && call.method === "POST"), true);
  assert.equal(calls.some((call) => call.path === "/api/conversations/6ffa7483-e955-46b0-93e9-f87e9f7ad9fe/run"), true);
});

test("commandExecution stop and retry hit real interrupt/run/conversation endpoints", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const id = "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe";
  const host = hostWith(async (opts) => {
    calls.push(opts);
    if (opts.path === "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC") return { items: [] };
    if (opts.path === `/api/conversations/${id}`) return { id, title: "Original", tags: { taskid: "task-1" } };
    if (opts.path === "/api/agent-profiles") return { profiles: [], active_agent_profile_id: null };
    if (opts.path === "/api/conversations") return { id };
    return {};
  });
  await commandExecution(host, "stop", { executionId: id });
  await commandExecution(host, "retry", { executionId: id });
  assert.ok(calls.some((call) => call.path === `/api/conversations/${id}/interrupt`));
  assert.ok(calls.some((call) => call.path === `/api/conversations/${id}/run`));
});

test("syncBoardAction records CRUD and updates/deletes matching conversations", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const id = "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe";
  const host = hostWith(async (opts) => {
    calls.push(opts);
    if (opts.path.startsWith("/api/conversations/search")) {
      return { items: [{ id, title: "Old", tags: { taskid: "task-1" } }] };
    }
    return {};
  });
  await syncBoardAction(host, "moved", "task-1", { status: "in_progress" });
  await syncBoardAction(host, "deleted", "task-1");
  assert.ok(calls.some((call) => call.method === "PATCH" && call.path === `/api/conversations/${id}`));
  assert.ok(calls.some((call) => call.method === "DELETE" && call.path === `/api/conversations/${id}`));
});

test("relay loop switches profiles, asks agents, and stop interrupts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const id = "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe";
  const host = hostWith(async (opts) => {
    calls.push(opts);
    if (opts.path === "/api/agent-profiles") return { profiles: [{ id: "11111111-1111-1111-1111-111111111111", name: "default" }], active_agent_profile_id: "11111111-1111-1111-1111-111111111111" };
    if (opts.path === "/api/conversations") return { id };
    if (opts.path.endsWith("/ask_agent")) return { response: "answer" };
    return {};
  });
  const hops: unknown[] = [];
  const handle = await startAgentRelay(host, { seed: "seed", agentNames: ["default"], maxHops: 1, delayMs: 0 }, (hop) => hops.push(hop));
  assert.ok(handle);
  await handle!.stop();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls.some((call) => call.path === `/api/conversations/${id}/switch_profile`));
  assert.ok(calls.some((call) => call.path === `/api/conversations/${id}/ask_agent`));
  assert.ok(calls.some((call) => call.path === `/api/conversations/${id}/interrupt`));
  assert.equal(hops.length, 2);
});

test("OpenHandsStateStore refresh, subscribe, unsubscribe, and dispose lifecycle", async () => {
  let requests = 0;
  const host = hostWith(async () => {
    requests += 1;
    return { items: [] };
  });
  const store = new OpenHandsStateStore(host);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });
  await store.refresh();
  assert.equal(store.get().loading, false);
  assert.equal(store.get().error, null);
  assert.equal(notifications, 2);
  unsubscribe();
  store.dispose();
  await store.refresh();
  assert.equal(requests >= 2, true);
});
