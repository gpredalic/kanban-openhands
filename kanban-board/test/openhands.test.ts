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
  fetchLlmProfiles,
  saveAgentProfile,
  activateAgentProfile,
  deleteAgentProfile,
  fetchAgentProfileDetail,
  buildProfileBody,
  saveAgentProfileFull,
  renameAgentProfile,
  fetchSecrets,
  materializeAgentProfile,
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
    active_agent_profile_id: "11111111-1111-1111-1111-111111111111",
    profiles: [
      { id: "11111111-1111-1111-1111-111111111111", name: "default", llm_profile_ref: "gpt-5" },
      { id: null, name: "missing-id" },
      { name: null },
    ],
  }));
  assert.deepEqual(await fetchAgentProfiles(host), [
    { id: "11111111-1111-1111-1111-111111111111", name: "default", llmProfileRef: "gpt-5", active: true },
    { id: "missing-id", name: "missing-id", llmProfileRef: undefined, active: false },
  ]);
});

test("fetchLlmProfiles maps the real /api/profiles response and rejects malformed profiles", async () => {
  const host = hostWith(async () => ({
    active_profile: "gpt-5",
    profiles: [
      { name: "gpt-5", model: "openai/gpt-5", base_url: "https://api.openai.com/v1", api_key_set: true },
      { name: null, model: "openai/gpt-4o" },
      { model: "anthropic/claude" },
    ],
  }));
  assert.deepEqual(await fetchLlmProfiles(host), [
    { name: "gpt-5", model: "openai/gpt-5", baseUrl: "https://api.openai.com/v1", active: true, apiKeySet: true },
  ]);
});

test("fetchLlmProfiles returns an empty list when the endpoint is unavailable", async () => {
  const host = hostWith(async () => {
    throw new Error("network down");
  });
  assert.deepEqual(await fetchLlmProfiles(host), []);
});

test("saveAgentProfile upserts via POST /api/agent-profiles/{name} with the llm ref", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await saveAgentProfile(host, "demo-researcher", "gpt-5"), "demo-researcher");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/agent-profiles/demo-researcher");
  assert.deepEqual(calls[0].body, { llm_profile_ref: "gpt-5" });
});

test("saveAgentProfile trims whitespace and rejects blank names or refs", async () => {
  const calls: unknown[] = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await saveAgentProfile(host, "  demo-researcher  ", "  gpt-5  "), "demo-researcher");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/agent-profiles/demo-researcher");
  assert.deepEqual(calls[0].body, { llm_profile_ref: "gpt-5" });
  assert.equal(await saveAgentProfile(host, "   ", "gpt-5"), null);
  assert.equal(await saveAgentProfile(host, "demo", "   "), null);
  assert.equal(calls.length, 1);
});

test("saveAgentProfile returns null when the request throws", async () => {
  const host = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await saveAgentProfile(host, "demo", "gpt-5"), null);
});

test("activateAgentProfile hits POST /api/agent-profiles/{id}/activate", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await activateAgentProfile(host, "22222222-2222-2222-2222-222222222222"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/agent-profiles/22222222-2222-2222-2222-222222222222/activate");
});

test("activateAgentProfile returns false when the request throws", async () => {
  const host = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await activateAgentProfile(host, "some-id"), false);
});

test("deleteAgentProfile hits DELETE /api/agent-profiles/{name}", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await deleteAgentProfile(host, "demo-researcher"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].path, "/api/agent-profiles/demo-researcher");
});

test("deleteAgentProfile rejects blank names and returns false on throw", async () => {
  const calls: unknown[] = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await deleteAgentProfile(host, "   "), false);
  assert.equal(calls.length, 0);
  const failing = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await deleteAgentProfile(failing, "demo"), false);
});

test("fetchAgentProfileDetail maps the full stored profile from GET /api/agent-profiles/{name}", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return {
      name: "demo-researcher",
      profile: {
        id: "11111111-1111-1111-1111-111111111111",
        name: "demo-researcher",
        llm_profile_ref: "gpt-5",
        revision: 3,
        agent: "CodeActAgent",
        tools: [{ name: "terminal", params: { cwd: "/repo" } }, { name: null }, { name: "grep" }],
        persona: "You are a careful researcher.",
        system_message_suffix: "Always cite sources.",
        mcp_server_refs: ["github", "notion"],
        secret_refs: ["GITHUB_TOKEN"],
        public_skills: ["code-review"],
        disabled_skills: ["ssh"],
        tool_concurrency_limit: 2,
      },
    };
  });
  const profile = await fetchAgentProfileDetail(host, "demo-researcher");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/api/agent-profiles/demo-researcher");
  assert.deepEqual(profile, {
    id: "11111111-1111-1111-1111-111111111111",
    name: "demo-researcher",
    llmProfileRef: "gpt-5",
    revision: 3,
    agent: "CodeActAgent",
    tools: [{ name: "terminal", params: { cwd: "/repo" } }, { name: "grep", params: undefined }],
    persona: "You are a careful researcher.",
    systemMessageSuffix: "Always cite sources.",
    mcpServerRefs: ["github", "notion"],
    secretRefs: ["GITHUB_TOKEN"],
    publicSkills: ["code-review"],
    disabledSkills: ["ssh"],
    toolConcurrencyLimit: 2,
  });
});

test("fetchAgentProfileDetail preserves null tools/refs and returns null on missing or failure", async () => {
  const host = hostWith(async () => ({
    name: "bare",
    profile: { id: "22222222-2222-2222-2222-222222222222", name: "bare", tools: null, mcp_server_refs: null, secret_refs: null, public_skills: null },
  }));
  const profile = await fetchAgentProfileDetail(host, "bare");
  assert.equal(profile?.tools, null);
  assert.equal(profile?.mcpServerRefs, null);
  assert.equal(profile?.secretRefs, null);
  assert.equal(profile?.publicSkills, null);
  assert.deepEqual(profile?.disabledSkills, []);
  assert.equal(profile?.persona, null);
  assert.equal(profile?.systemMessageSuffix, null);

  const missing = hostWith(async () => ({ name: "nope" }));
  assert.equal(await fetchAgentProfileDetail(missing, "nope"), null);
  const failing = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await fetchAgentProfileDetail(failing, "demo"), null);
  assert.equal(await fetchAgentProfileDetail(host, "   "), null);
});

test("buildProfileBody emits only managed fields and omits the id", () => {
  const body = buildProfileBody({
    id: "11111111-1111-1111-1111-111111111111",
    name: "demo",
    llmProfileRef: "gpt-5",
    agent: "CodeActAgent",
    tools: [{ name: "terminal" }],
    persona: "persona",
    systemMessageSuffix: "suffix",
    mcpServerRefs: ["github"],
    secretRefs: ["GITHUB_TOKEN"],
    publicSkills: ["code-review"],
    disabledSkills: ["ssh"],
    toolConcurrencyLimit: 2,
  });
  assert.deepEqual(body, {
    agent_kind: "openhands",
    llm_profile_ref: "gpt-5",
    agent: "CodeActAgent",
    tools: [{ name: "terminal" }],
    persona: "persona",
    system_message_suffix: "suffix",
    mcp_server_refs: ["github"],
    secret_refs: ["GITHUB_TOKEN"],
    public_skills: ["code-review"],
    disabled_skills: ["ssh"],
    tool_concurrency_limit: 2,
  });
  assert.equal("id" in body, false);
  assert.equal("name" in body, false);
  // A minimal profile emits only the two always-present keys.
  assert.deepEqual(buildProfileBody({ id: "x", name: "x" }), { agent_kind: "openhands", llm_profile_ref: "" });
});

test("saveAgentProfileFull upserts via POST /api/agent-profiles/{name} with the full body", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await saveAgentProfileFull(host, "demo-researcher", { id: "1", name: "demo-researcher", llmProfileRef: "gpt-5", persona: "p" }), "demo-researcher");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/agent-profiles/demo-researcher");
  assert.deepEqual(calls[0].body, { agent_kind: "openhands", llm_profile_ref: "gpt-5", persona: "p" });
  assert.equal(await saveAgentProfileFull(host, "   ", { id: "1", name: "x" }), null);
  const failing = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await saveAgentProfileFull(failing, "demo", { id: "1", name: "demo" }), null);
});

test("renameAgentProfile hits POST /api/agent-profiles/{oldName}/rename with new_name", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return { ok: true };
  });
  assert.equal(await renameAgentProfile(host, "old-name", "new-name"), "new-name");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/agent-profiles/old-name/rename");
  assert.deepEqual(calls[0].body, { new_name: "new-name" });
  assert.equal(await renameAgentProfile(host, "   ", "new"), null);
  assert.equal(await renameAgentProfile(host, "old", "   "), null);
  assert.equal(calls.length, 1);
  const failing = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await renameAgentProfile(failing, "old", "new"), null);
});

test("fetchSecrets maps the real /api/settings/secrets response and rejects malformed entries", async () => {
  const host = hostWith(async () => ({
    secrets: [
      { name: "GITHUB_TOKEN", description: "repo access" },
      { name: null, description: "no name" },
      { description: "no name either" },
    ],
  }));
  assert.deepEqual(await fetchSecrets(host), [{ name: "GITHUB_TOKEN", description: "repo access" }]);
  const failing = hostWith(async () => {
    throw new Error("boom");
  });
  assert.deepEqual(await fetchSecrets(failing), []);
});

test("materializeAgentProfile maps the dry-run diagnostics report", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const host = hostWith(async (opts) => {
    calls.push(opts);
    return {
      agent_kind: "openhands",
      valid: true,
      errors: [],
      unusable_tools: ["browser_tool_set"],
      llm_profile_ref: "gpt-5",
      llm_profile_resolved: true,
      llm_api_key_set: true,
      dangling_mcp_server_refs: ["notion"],
      resolved_skills: ["code-review"],
      dangling_meta_profile_ref: null,
    };
  });
  const report = await materializeAgentProfile(host, "demo-researcher");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/agent-profiles/demo-researcher/materialize");
  assert.deepEqual(report, {
    agentKind: "openhands",
    valid: true,
    errors: [],
    unusableTools: ["browser_tool_set"],
    llmProfileRef: "gpt-5",
    llmProfileResolved: true,
    llmApiKeySet: true,
    danglingMcpServerRefs: ["notion"],
    resolvedSkills: ["code-review"],
    danglingMetaProfileRef: null,
  });
  const failing = hostWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await materializeAgentProfile(failing, "demo"), null);
  assert.equal(await materializeAgentProfile(host, "   "), null);
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

test("commandExecution start reuses the linked conversation instead of creating a new one", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const id = "6ffa7483-e955-46b0-93e9-f87e9f7ad9fe";
  const host = hostWith(async (opts) => {
    calls.push(opts);
    if (opts.path === "/api/conversations") return { id: "brand-new-conversation-id" };
    return {};
  });
  // A task that already has a linked conversation: Run must reuse it, not spawn a new one.
  await commandExecution(host, "start", { taskId: "task-1", title: "Implement", executionId: id });
  // No new conversation is created.
  assert.equal(calls.some((call) => call.path === "/api/conversations" && call.method === "POST"), false);
  // The existing conversation is re-run.
  assert.equal(calls.some((call) => call.path === `/api/conversations/${id}/run` && call.method === "POST"), true);
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
