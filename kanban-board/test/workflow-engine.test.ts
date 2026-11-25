import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEdge,
  evaluateExpression,
  computeRouting,
  detectLoops,
  loopEdgeIds,
  edgeGeometry,
  arrowheadPath,
  tracePath,
  NODE_W,
  NODE_H,
  type NodeStateInput,
} from "../src/lib/workflow-engine";
import type { WorkflowNode, WorkflowEdge, EdgeCondition } from "../src/types/ai";

/* ------------------------- helpers ------------------------- */

function node(id: string, over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: "task",
    label: id,
    x: 0,
    y: 0,
    ...over,
  };
}

function edge(id: string, from: string, to: string, condition: EdgeCondition, over: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id, from, to, condition, ...over };
}

function state(s: NodeStateInput["state"], over: Partial<NodeStateInput> = {}): NodeStateInput {
  return { state: s, ...over };
}

/* ------------------------- branch types ------------------------- */

test("branch type: success fires only when the node completed", () => {
  const e = edge("e1", "a", "b", "IF_SUCCESS");
  assert.equal(evaluateEdge(e, state("completed")), true);
  assert.equal(evaluateEdge(e, state("failed")), false);
  assert.equal(evaluateEdge(e, state("running")), false);
});

test("branch type: failure fires only when the node failed", () => {
  const e = edge("e1", "a", "b", "IF_FAILURE");
  assert.equal(evaluateEdge(e, state("failed")), true);
  assert.equal(evaluateEdge(e, state("completed")), false);
});

test("branch type: retry fires only when failed AND retries exhausted", () => {
  const e = edge("e1", "a", "b", "IF_RETRY_EXHAUSTED");
  assert.equal(evaluateEdge(e, state("failed", { retriesExhausted: true })), true);
  assert.equal(evaluateEdge(e, state("failed", { retriesExhausted: false })), false);
  assert.equal(evaluateEdge(e, state("completed", { retriesExhausted: true })), false);
});

test("branch type: timeout fires only when the node timed out", () => {
  const e = edge("e1", "a", "b", "IF_TIMEOUT");
  assert.equal(evaluateEdge(e, state("timed_out")), true);
  assert.equal(evaluateEdge(e, state("failed")), false);
});

test("branch type: cancel fires only when the node was cancelled", () => {
  const e = edge("e1", "a", "b", "IF_CANCEL");
  assert.equal(evaluateEdge(e, state("cancelled")), true);
  assert.equal(evaluateEdge(e, state("failed")), false);
});

test("branch type: manual approval fires when awaiting, approved, or rejected", () => {
  const awaiting = edge("e1", "a", "b", "IF_MANUAL_APPROVAL");
  assert.equal(evaluateEdge(awaiting, state("awaiting_approval")), true);
  assert.equal(evaluateEdge(awaiting, state("completed")), false);

  const approved = edge("e2", "a", "b", "IF_APPROVED");
  assert.equal(evaluateEdge(approved, state("completed", { approved: true })), true);
  assert.equal(evaluateEdge(approved, state("completed", { approved: false })), false);

  const rejected = edge("e3", "a", "b", "IF_REJECTED");
  assert.equal(evaluateEdge(rejected, state("failed", { approved: false })), true);
  assert.equal(evaluateEdge(rejected, state("failed", { approved: true })), false);
});

test("branch type: conditional fires on the expression result", () => {
  const t = edge("e1", "a", "b", "IF_TRUE", { expression: "amount > 1000" });
  const f = edge("e2", "a", "b", "IF_FALSE", { expression: "amount > 1000" });
  assert.equal(evaluateEdge(t, state("completed", { outputs: { amount: 2000 } })), true);
  assert.equal(evaluateEdge(f, state("completed", { outputs: { amount: 2000 } })), false);
  assert.equal(evaluateEdge(t, state("completed", { outputs: { amount: 500 } })), false);
  assert.equal(evaluateEdge(f, state("completed", { outputs: { amount: 500 } })), true);
});

test("branch type: loop fires when the node completed (limit enforced by caller)", () => {
  const e = edge("e1", "a", "b", "IF_LOOP");
  assert.equal(evaluateEdge(e, state("completed")), true);
  assert.equal(evaluateEdge(e, state("running")), false);
});

test("branch type: always fires regardless of state", () => {
  const e = edge("e1", "a", "b", "IF_ALWAYS");
  assert.equal(evaluateEdge(e, state("idle")), true);
  assert.equal(evaluateEdge(e, state("failed")), true);
});

/* ------------------------- conditional expressions ------------------------- */

test("evaluateExpression: comparisons", () => {
  assert.equal(evaluateExpression("amount > 1000", { amount: 2000 }), true);
  assert.equal(evaluateExpression("amount > 1000", { amount: 500 }), false);
  assert.equal(evaluateExpression("count >= 3", { count: 3 }), true);
  assert.equal(evaluateExpression("count <= 3", { count: 4 }), false);
  assert.equal(evaluateExpression("status == 'approved'", { status: "approved" }), true);
  assert.equal(evaluateExpression("status != 'approved'", { status: "rejected" }), true);
});

test("evaluateExpression: boolean variables and negation", () => {
  assert.equal(evaluateExpression("approved", { approved: true }), true);
  assert.equal(evaluateExpression("approved", { approved: false }), false);
  assert.equal(evaluateExpression("!approved", { approved: false }), true);
  assert.equal(evaluateExpression("!approved", { approved: true }), false);
});

test("evaluateExpression: logical && and ||", () => {
  assert.equal(evaluateExpression("a && b", { a: true, b: true }), true);
  assert.equal(evaluateExpression("a && b", { a: true, b: false }), false);
  assert.equal(evaluateExpression("a || b", { a: false, b: true }), true);
  assert.equal(evaluateExpression("a || b", { a: false, b: false }), false);
});

test("evaluateExpression: absent or malformed returns null", () => {
  assert.equal(evaluateExpression(undefined, {}), null);
  assert.equal(evaluateExpression("   ", {}), null);
  assert.equal(evaluateExpression("missing > 5", {}), null);
});

/* ------------------------- routing (architecture proof) ------------------------- */

test("computeRouting: a running node is current and not terminal, but its success edge has not fired yet", () => {
  const nodes = [node("start", { type: "start" }), node("a"), node("b")];
  const edges = [
    edge("e1", "start", "a", "IF_SUCCESS"),
    edge("e2", "a", "b", "IF_SUCCESS"),
  ];
  const states = { start: state("completed"), a: state("running"), b: state("idle") };
  const r = computeRouting({ nodes, edges, states });
  // The running node is the current node and the workflow is not terminal.
  assert.equal(r.currentNode?.id, "a");
  assert.equal(r.terminal, false);
  // But its IF_SUCCESS edge only fires on completion, so nothing fires yet.
  assert.equal(r.nextNode, null);
  assert.equal(r.nextEdge, null);
});

test("computeRouting: a completed node triggers its next node (the core routing fix)", () => {
  const nodes = [node("start", { type: "start" }), node("a"), node("b")];
  const edges = [
    edge("e1", "start", "a", "IF_SUCCESS"),
    edge("e2", "a", "b", "IF_SUCCESS"),
  ];
  // Node A has completed; nothing is running. The engine must route from A.
  const states = { start: state("completed"), a: state("completed"), b: state("idle") };
  const r = computeRouting({ nodes, edges, states });
  assert.equal(r.currentNode?.id, "a");
  assert.equal(r.nextNode?.id, "b");
  assert.equal(r.nextEdge?.id, "e2");
  assert.equal(r.terminal, false);
});

test("computeRouting: when several nodes are terminal, the most recently completed one drives routing", () => {
  const nodes = [node("a"), node("b"), node("c"), node("d")];
  const edges = [
    edge("e1", "a", "b", "IF_SUCCESS"),
    edge("e2", "b", "c", "IF_SUCCESS"),
    edge("e3", "c", "d", "IF_SUCCESS"),
  ];
  // Both A and C are completed, but C completed later (higher completedAt).
  const states = {
    a: state("completed", { completedAt: 1 }),
    b: state("completed", { completedAt: 2 }),
    c: state("completed", { completedAt: 3 }),
    d: state("idle"),
  };
  const r = computeRouting({ nodes, edges, states });
  // C is the most recent terminal node, so it routes to D.
  assert.equal(r.currentNode?.id, "c");
  assert.equal(r.nextNode?.id, "d");
});

test("computeRouting: priority decides which of multiple firing edges is next", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    edge("e1", "a", "b", "IF_SUCCESS", { priority: 2 }),
    edge("e2", "a", "c", "IF_SUCCESS", { priority: 1 }),
  ];
  const states = { a: state("completed"), b: state("idle"), c: state("idle") };
  const r = computeRouting({ nodes, edges, states });
  // Both fire (multi-way fan-out), but the lower-priority-number edge is next.
  assert.equal(r.firingEdges.length, 2);
  assert.equal(r.nextEdge?.id, "e2");
  assert.equal(r.nextNode?.id, "c");
});

test("computeRouting: a failed node routes down the failure edge, not the success edge", () => {
  const nodes = [node("a"), node("ok"), node("err")];
  const edges = [
    edge("e1", "a", "ok", "IF_SUCCESS"),
    edge("e2", "a", "err", "IF_FAILURE"),
  ];
  const states = { a: state("failed"), ok: state("idle"), err: state("idle") };
  const r = computeRouting({ nodes, edges, states });
  assert.equal(r.nextEdge?.id, "e2");
  assert.equal(r.nextNode?.id, "err");
});

test("computeRouting: terminal when the current node has no firing edge", () => {
  const nodes = [node("a"), node("b")];
  const edges = [edge("e1", "a", "b", "IF_SUCCESS")];
  const states = { a: state("failed"), b: state("idle") };
  const r = computeRouting({ nodes, edges, states });
  assert.equal(r.nextNode, null);
  assert.equal(r.terminal, true);
});

test("computeRouting: empty graph is terminal with no current node", () => {
  const r = computeRouting({ nodes: [], edges: [], states: {} });
  assert.equal(r.currentNode, null);
  assert.equal(r.terminal, true);
});

/* ------------------------- loop routing + limits ------------------------- */

test("detectLoops: finds the A → B → C → A cycle", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    edge("e1", "a", "b", "IF_SUCCESS"),
    edge("e2", "b", "c", "IF_SUCCESS"),
    edge("e3", "c", "a", "IF_LOOP"),
  ];
  const cycles = detectLoops(nodes, edges);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].sort(), ["a", "b", "c"]);
});

test("detectLoops: a DAG has no loops", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    edge("e1", "a", "b", "IF_SUCCESS"),
    edge("e2", "b", "c", "IF_SUCCESS"),
  ];
  assert.deepEqual(detectLoops(nodes, edges), []);
});

test("loopEdgeIds: marks the back edge of a loop", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    edge("e1", "a", "b", "IF_SUCCESS"),
    edge("e2", "b", "c", "IF_SUCCESS"),
    edge("e3", "c", "a", "IF_LOOP"),
  ];
  const ids = loopEdgeIds(nodes, edges);
  assert.ok(ids.has("e3"));
  assert.ok(!ids.has("e1"));
  assert.ok(!ids.has("e2"));
});

test("computeRouting: a loop edge fires until its limit, then is exhausted", () => {
  const nodes = [node("a"), node("b")];
  const edges = [edge("e1", "a", "b", "IF_LOOP", { loopLimit: 3 })];
  const states = { a: state("completed"), b: state("idle") };

  // Below the limit: the loop fires.
  const under = computeRouting({ nodes, edges, states, loopCounts: { e1: 2 } });
  assert.equal(under.nextEdge?.id, "e1");
  assert.equal(under.exhaustedLoops.length, 0);

  // At the limit: the loop is cut off.
  const at = computeRouting({ nodes, edges, states, loopCounts: { e1: 3 } });
  assert.equal(at.nextEdge, null);
  assert.equal(at.exhaustedLoops.length, 1);
  assert.equal(at.exhaustedLoops[0].id, "e1");
  assert.equal(at.terminal, true);
});

test("computeRouting: default loop limit is 10 when absent", () => {
  const nodes = [node("a"), node("b")];
  const edges = [edge("e1", "a", "b", "IF_LOOP")];
  const states = { a: state("completed"), b: state("idle") };
  const atDefault = computeRouting({ nodes, edges, states, loopCounts: { e1: 10 } });
  assert.equal(atDefault.exhaustedLoops.length, 1);
  const underDefault = computeRouting({ nodes, edges, states, loopCounts: { e1: 9 } });
  assert.equal(underDefault.exhaustedLoops.length, 0);
});

/* ------------------------- multi-way (N-way) fan-out ------------------------- */

test("computeRouting: a 3-way node fans out to all matching edges", () => {
  const nodes = [node("a", { outputPorts: 3 }), node("b"), node("c"), node("d")];
  const edges = [
    edge("e1", "a", "b", "IF_SUCCESS"),
    edge("e2", "a", "c", "IF_SUCCESS"),
    edge("e3", "a", "d", "IF_SUCCESS"),
  ];
  const states = { a: state("completed"), b: state("idle"), c: state("idle"), d: state("idle") };
  const r = computeRouting({ nodes, edges, states });
  assert.equal(r.firingEdges.length, 3);
  assert.deepEqual(r.firingEdges.map((e) => e.id).sort(), ["e1", "e2", "e3"]);
});

test("edgeGeometry: multi-way ports fan out from distinct y offsets", () => {
  const from = node("a", { x: 0, y: 0, outputPorts: 3 });
  const to = node("b", { x: 400, y: 0 });
  const g0 = edgeGeometry(from, to, 0, 3);
  const g1 = edgeGeometry(from, to, 1, 3);
  const g2 = edgeGeometry(from, to, 2, 3);
  // Port 0 starts above center, port 1 at center, port 2 below center.
  const start = (g: { d: string }) => {
    const m = g.d.match(/^M ([\d.]+) ([\d.]+)/);
    return m ? Number(m[2]) : NaN;
  };
  assert.ok(start(g0) < NODE_H / 2, "port 0 above center");
  assert.equal(start(g1), NODE_H / 2, "port 1 at center");
  assert.ok(start(g2) > NODE_H / 2, "port 2 below center");
});

test("edgeGeometry: a single-port node has no offset", () => {
  const from = node("a", { x: 0, y: 0 });
  const to = node("b", { x: 400, y: 0 });
  const g = edgeGeometry(from, to, 0, 1);
  const m = g.d.match(/^M ([\d.]+) ([\d.]+)/);
  assert.equal(Number(m![2]), NODE_H / 2);
});

/* ------------------------- smart geometry ------------------------- */

test("edgeGeometry: a forward edge is not a loop and starts at the source right edge", () => {
  const from = node("a", { x: 0, y: 0 });
  const to = node("b", { x: 400, y: 0 });
  const g = edgeGeometry(from, to);
  assert.equal(g.isLoop, false);
  const m = g.d.match(/^M ([\d.]+) ([\d.]+)/);
  assert.equal(Number(m![1]), NODE_W, "starts at the source's right edge");
  assert.ok(g.d.startsWith("M "), "is an SVG path");
});

test("edgeGeometry: a backward edge (target to the left) is a loop arrow", () => {
  const from = node("a", { x: 400, y: 0 });
  const to = node("b", { x: 0, y: 0 });
  const g = edgeGeometry(from, to);
  assert.equal(g.isLoop, true);
  // The loop routes below both nodes.
  assert.ok(g.mid.y > NODE_H, "loop midpoint is below the nodes");
});

test("edgeGeometry: a same-column edge bows out to the side", () => {
  const from = node("a", { x: 0, y: 0 });
  const to = node("b", { x: 0, y: 300 });
  const g = edgeGeometry(from, to);
  assert.equal(g.isLoop, false);
  assert.ok(g.d.includes("C "), "uses a bezier curve");
});

test("arrowheadPath: produces a closed triangle oriented by angle", () => {
  const d = arrowheadPath(100, 100, 0);
  assert.ok(d.startsWith("M "), "is an SVG path");
  assert.ok(d.endsWith("Z"), "is a closed path");
  assert.ok(d.includes("L "), "has line segments");
});

/* ------------------------- path tracing ------------------------- */

test("tracePath: walks from the start node to the target", () => {
  const nodes = [node("start", { type: "start" }), node("a"), node("b")];
  const edges = [
    edge("e1", "start", "a", "IF_SUCCESS"),
    edge("e2", "a", "b", "IF_SUCCESS"),
  ];
  const path = tracePath(nodes, edges, "b");
  assert.deepEqual(path.map((n) => n.id), ["start", "a", "b"]);
});

test("tracePath: returns an empty path for an unreachable target", () => {
  const nodes = [node("start", { type: "start" }), node("isolated")];
  const path = tracePath(nodes, [], "isolated");
  assert.deepEqual(path, []);
});
