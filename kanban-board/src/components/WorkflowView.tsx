/**
 * WorkflowView — visual node-graph workflow editor.
 *
 * Replaces the old form-based dependency editor with a canvas where each task
 * (or agent / condition / approval / start / end / delay) is a node with an
 * input port (left) and an output port (right). Users create dependencies by
 * dragging from one node's output port to another node's input port. Edges are
 * condition-labelled (IF_SUCCESS, IF_APPROVED, …) and editable. Nodes are
 * draggable, and a node inspector assigns an OpenHands profile and shows the
 * live execution state for task nodes.
 *
 * The persistence model is unchanged: the full workflow (nodes + edges) is
 * written back through onUpdate, which the store uploads to workflows.json.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Plus,
  Play,
  Trash2,
  Wand2,
  MousePointer2,
  GitBranch,
  Circle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Zap,
  Flag,
  Square,
  Loader2,
  Repeat,
  RefreshCw,
  Timer,
  Ban,
  UserCheck,
  GitMerge,
  RotateCcw,
  Save,
  Copy,
} from "lucide-react";
import type {
  AiState,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowNodeConfig,
  EdgeCondition,
  EnrichedTask,
  Agent,
  BranchType,
} from "../types/ai";
import { branchTypeForCondition } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";
import { autoLayout } from "../lib/ai-engine";
import {
  edgeGeometry,
  NODE_W,
  NODE_H,
} from "../lib/workflow-engine";
import { useWorkflowRouting, nodeExecState } from "../hooks/useWorkflowRouting";

/* ------------------------------------------------------------------ *
 * Geometry + node metadata.
 * ------------------------------------------------------------------ */

const PORT_R = 7;
const CANVAS_W = 1600;
const CANVAS_H = 900;

interface NodeMeta {
  label: string;
  /** Tailwind classes for the type badge. */
  badge: string;
  /** Solid accent colour for the node's left bar. */
  accent: string;
  icon: typeof Circle;
}

const NODE_META: Record<WorkflowNodeType, NodeMeta> = {
  task: { label: "Task", badge: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/30", accent: "#6366f1", icon: Circle },
  agent: { label: "Agent", badge: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/30", accent: "#06b6d4", icon: Zap },
  condition: { label: "Condition", badge: "bg-amber-500/15 text-amber-300 ring-amber-400/30", accent: "#f59e0b", icon: GitBranch },
  approval: { label: "Approval", badge: "bg-rose-500/15 text-rose-300 ring-rose-400/30", accent: "#f43f5e", icon: ShieldCheck },
  start: { label: "Start", badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30", accent: "#10b981", icon: Play },
  end: { label: "End", badge: "bg-slate-500/15 text-slate-300 ring-slate-400/30", accent: "#64748b", icon: Flag },
  delay: { label: "Delay", badge: "bg-violet-500/15 text-violet-300 ring-violet-400/30", accent: "#8b5cf6", icon: Clock },
  relay: { label: "Relay", badge: "bg-sky-500/15 text-sky-300 ring-sky-400/30", accent: "#0ea5e9", icon: Repeat },
  loop: { label: "Loop", badge: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-400/30", accent: "#d946ef", icon: RefreshCw },
};

/** The eight branch types, each with a label and icon for the edge inspector. */
const BRANCH_META: Record<BranchType, { label: string; icon: LucideIcon }> = {
  success: { label: "Success", icon: CheckCircle2 },
  failure: { label: "Failure", icon: XCircle },
  retry: { label: "Retry", icon: RotateCcw },
  timeout: { label: "Timeout", icon: Timer },
  cancel: { label: "Cancel", icon: Ban },
  manual_approval: { label: "Manual Approval", icon: UserCheck },
  conditional: { label: "Conditional", icon: GitMerge },
  loop: { label: "Loop", icon: RefreshCw },
};

/** All edge conditions, grouped by branch type for the inspector. */
const CONDITION_OPTIONS: { value: EdgeCondition; label: string }[] = [
  { value: "IF_SUCCESS", label: "On success" },
  { value: "IF_FAILURE", label: "On failure" },
  { value: "IF_RETRY_EXHAUSTED", label: "Retries exhausted" },
  { value: "IF_TIMEOUT", label: "On timeout" },
  { value: "IF_CANCEL", label: "On cancel" },
  { value: "IF_MANUAL_APPROVAL", label: "Manual approval" },
  { value: "IF_APPROVED", label: "On approval" },
  { value: "IF_REJECTED", label: "On rejection" },
  { value: "IF_TRUE", label: "Condition true" },
  { value: "IF_FALSE", label: "Condition false" },
  { value: "IF_LOOP", label: "Loop back" },
  { value: "IF_ALWAYS", label: "Always" },
];

/** The execution state of a node, derived from the OpenHands snapshot. */
type NodeExecState = "idle" | "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

const EXEC_META: Record<NodeExecState, { label: string; icon: typeof Circle; spin: boolean }> = {
  idle: { label: "Idle", icon: Circle, spin: false },
  pending: { label: "Pending", icon: Clock, spin: false },
  queued: { label: "Queued", icon: Clock, spin: false },
  running: { label: "Running", icon: Loader2, spin: true },
  completed: { label: "Completed", icon: CheckCircle2, spin: false },
  failed: { label: "Failed", icon: XCircle, spin: false },
  cancelled: { label: "Cancelled", icon: Square, spin: false },
};

/* ------------------------------------------------------------------ *
 * Drag state.
 * ------------------------------------------------------------------ */

type DragState =
  | { kind: "node"; nodeId: string; offsetX: number; offsetY: number }
  | { kind: "edge"; from: string; portIndex: number };

interface PendingEdge {
  from: string;
  x: number;
  y: number;
  /** Which output port the drag started from (multi-way nodes). */
  portIndex: number;
}

/* ------------------------------------------------------------------ *
 * Props.
 * ------------------------------------------------------------------ */

interface WorkflowViewProps {
  aiState: AiState;
  tasks: EnrichedTask[];
  openHandsState: OpenHandsState;
  /** OpenHands profiles available for node assignment. */
  profiles: Agent[];
  onCreate: (workflow: Workflow) => void;
  onUpdate: (workflow: Workflow) => void;
  onDelete: (workflowId: string) => void;
}

/* ------------------------------------------------------------------ *
 * Component.
 * ------------------------------------------------------------------ */

export function WorkflowView({
  aiState,
  tasks,
  openHandsState,
  profiles,
  onCreate,
  onUpdate,
  onDelete,
}: WorkflowViewProps) {
  const workflows = aiState.config.workflows;
  const [selectedId, setSelectedId] = useState<string | null>(workflows[0]?.id ?? null);
  const workflow = workflows.find((w) => w.id === selectedId) ?? null;

  // Local editing state for the selected workflow's graph.
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  // Save state: the builder edits a local copy of the graph. Changes are
  // "dirty" until the user explicitly saves (or saves-as). This decouples
  // editing from persistence so the user always knows the save state.
  const [dirty, setDirty] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  // Drag state.
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingEdge, setPendingEdge] = useState<PendingEdge | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Sync local state when the selected workflow changes.
  useEffect(() => {
    if (workflow) {
      setNodes(workflow.nodes.map((n) => ({ ...n })));
      setEdges(workflow.edges.map((e) => ({ ...e })));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    } else {
      setNodes([]);
      setEdges([]);
    }
    // Switching workflows discards any unsaved edits to the previous one and
    // resets the save state.
    setDirty(false);
    setShowSaveAs(false);
    setSaveAsName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /* ------------------------- routing (engine-driven) ------------------------- */

  // The engine computes which edges are active from the node states. This is
  // the single source of truth for "what is executing / what is next" — routing
  // is derived purely from nodes, connections, and the OpenHands snapshot. The
  // same hook the Monitoring view uses, so the canvas highlight and the
  // monitoring readout can never disagree.
  const { activeEdges, activeNodes, loopEdgeSet, loopCounts } =
    useWorkflowRouting(nodes, edges, openHandsState);

  /** Mark the graph as edited. The local copy is the source of truth while
   *  editing; nothing is written back until the user saves. */
  const persist = (_nextNodes: WorkflowNode[], _nextEdges: WorkflowEdge[]) => {
    setDirty(true);
  };

  /** Write the current graph back to the selected workflow and clear the
   *  dirty flag. */
  const save = () => {
    if (!workflow || !dirty) return;
    onUpdate({ ...workflow, nodes, edges });
    setDirty(false);
  };

  /** Save the current graph as a new workflow with a different name. */
  const saveAs = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !workflow) return;
    const id = `wf-${Date.now()}`;
    onCreate({
      id,
      name: trimmed,
      description: workflow.description,
      nodes: nodes.map((n) => ({ ...n })),
      edges: edges.map((e) => ({ ...e })),
      status: "draft",
    });
    setSelectedId(id);
    setShowSaveAs(false);
    setSaveAsName("");
    setDirty(false);
  };

  /* ------------------------- node handlers ------------------------- */

  const addNode = (type: WorkflowNodeType) => {
    if (!workflow) return;
    const id = `n-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const node: WorkflowNode = {
      id,
      type,
      label: NODE_META[type].label,
      x: 80 + (nodes.length % 4) * 240,
      y: 80 + Math.floor(nodes.length / 4) * 140,
    };
    const next = [...nodes, node];
    setNodes(next);
    persist(next, edges);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const deleteNode = (nodeId: string) => {
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    persist(nextNodes, nextEdges);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  const updateNode = (nodeId: string, patch: Partial<WorkflowNode>) => {
    const next = nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
    setNodes(next);
    persist(next, edges);
  };

  /* ------------------------- edge handlers ------------------------- */

  const createEdge = (from: string, to: string) => {
    if (from === to) return;
    if (edges.some((e) => e.from === from && e.to === to)) return;
    const edge: WorkflowEdge = {
      id: `e-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      from,
      to,
      condition: "IF_SUCCESS",
    };
    const next = [...edges, edge];
    setEdges(next);
    persist(nodes, next);
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  };

  const deleteEdge = (edgeId: string) => {
    const next = edges.filter((e) => e.id !== edgeId);
    setEdges(next);
    persist(nodes, next);
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
  };

  const updateEdge = (edgeId: string, patch: Partial<WorkflowEdge>) => {
    const next = edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e));
    setEdges(next);
    persist(nodes, next);
  };

  /* ------------------------- layout ------------------------- */

  const autoArrange = () => {
    const layout = autoLayout(nodes, edges);
    const posById = new Map(layout.nodes.map((p) => [p.id, p]));
    const next = nodes.map((n) => {
      const p = posById.get(n.id);
      return p ? { ...n, x: 80 + p.layer * 240, y: 80 + p.row * 140 } : n;
    });
    setNodes(next);
    persist(next, edges);
  };

  /* ------------------------- workflow handlers ------------------------- */

  const createWorkflow = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `wf-${Date.now()}`;
    const startNode: WorkflowNode = { id: `${id}-start`, type: "start", label: "Start", x: 80, y: 160 };
    onCreate({ id, name: trimmed, description: "User-created workflow", nodes: [startNode], edges: [], status: "draft" });
    setSelectedId(id);
    setShowCreate(false);
    setNewName("");
  };

  const deleteWorkflow = () => {
    if (!workflow) return;
    onDelete(workflow.id);
    setSelectedId(workflows.find((w) => w.id !== workflow.id)?.id ?? null);
  };

  /* ------------------------- pointer handlers ------------------------- */

  const svgPoint = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onNodePointerDown = (e: React.PointerEvent, node: WorkflowNode) => {
    e.stopPropagation();
    const p = svgPoint(e);
    setDrag({ kind: "node", nodeId: node.id, offsetX: p.x - node.x, offsetY: p.y - node.y });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  };

  const onOutputPortPointerDown = (e: React.PointerEvent, node: WorkflowNode, portIndex = 0) => {
    e.stopPropagation();
    const portCount = Math.max(1, node.outputPorts ?? 1);
    const portOffset = portCount > 1 ? (portIndex / (portCount - 1) - 0.5) * (NODE_H - 24) : 0;
    setDrag({ kind: "edge", from: node.id, portIndex });
    setPendingEdge({ from: node.id, x: node.x + NODE_W, y: node.y + NODE_H / 2 + portOffset, portIndex });
  };

  const onInputPortPointerUp = (e: React.PointerEvent, node: WorkflowNode) => {
    e.stopPropagation();
    if (pendingEdge && pendingEdge.from !== node.id) {
      createEdge(pendingEdge.from, node.id);
    }
    setPendingEdge(null);
    setDrag(null);
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = svgPoint(e);
    if (drag.kind === "node") {
      const x = Math.max(0, Math.min(CANVAS_W - NODE_W, p.x - drag.offsetX));
      const y = Math.max(0, Math.min(CANVAS_H - NODE_H, p.y - drag.offsetY));
      setNodes((current) => current.map((n) => (n.id === drag.nodeId ? { ...n, x, y } : n)));
    } else if (drag.kind === "edge") {
      setPendingEdge((current) => (current ? { ...current, x: p.x, y: p.y } : current));
    }
  };

  const onSvgPointerUp = () => {
    // Releasing over the background cancels a pending edge.
    setPendingEdge(null);
    setDrag(null);
  };

  // Persist the final node position when a node drag ends.
  const onNodeDragEnd = () => {
    if (drag?.kind === "node") {
      persist(nodes, edges);
    }
    setDrag(null);
  };

  /* ------------------------- edge geometry (engine-driven) ------------------------- */

  // Edge paths are computed by the engine's edgeGeometry, which handles
  // forward (left→right) and backward (right→left, i.e. loop) routing with
  // curved bezier paths and correct arrowhead direction. Multi-way nodes fan
  // their outgoing edges out from distinct output ports.
  const edgePath = (from: WorkflowNode, to: WorkflowNode, portIndex = 0, portCount = 1) => {
    const geo = edgeGeometry(from, to, portIndex, portCount);
    return geo.d;
  };

  // For a multi-way node, the port index an edge leaves from is its position
  // among the node's outgoing edges (ordered by priority, then id).
  const portIndexForEdge = (edge: WorkflowEdge): { index: number; count: number } => {
    const from = nodeById.get(edge.from);
    const count = Math.max(1, from?.outputPorts ?? 1);
    if (count <= 1) return { index: 0, count: 1 };
    const outgoing = edges
      .filter((e) => e.from === edge.from)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
    const idx = outgoing.findIndex((e) => e.id === edge.id);
    return { index: Math.max(0, idx), count };
  };

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) ?? null : null;

  /* ------------------------- empty state ------------------------- */

  if (workflows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="kb-glass flex h-16 w-16 items-center justify-center rounded-2xl">
          <GitBranch className="h-8 w-8 text-indigo-300" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">No workflows defined</h2>
          <p className="mt-1 text-sm text-slate-400">Create a workflow to design a node graph.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Create workflow
        </button>
        {showCreate && (
          <div className="kb-glass mt-2 flex w-72 flex-col gap-3 rounded-2xl p-4">
            <input
              type="text"
              aria-label="Workflow name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workflow name"
              className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => createWorkflow(newName)}
              className="kb-gradient rounded-xl px-3 py-2 text-sm font-semibold text-white"
            >
              Create
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ------------------------- main render ------------------------- */

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Select workflow"
            className="kb-glass-sm rounded-xl border-0 bg-transparent px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id} className="bg-slate-900">
                {w.name}
              </option>
            ))}
          </select>
          {workflow && (
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${workflow.status === "active" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" : workflow.status === "completed" ? "bg-slate-500/15 text-slate-300 ring-slate-400/30" : "bg-amber-500/15 text-amber-300 ring-amber-400/30"}`}>
              {workflow.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-400/30">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            onClick={autoArrange}
            className="kb-glass-sm kb-btn-glow flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <Wand2 className="h-3.5 w-3.5" strokeWidth={2} />
            Auto-arrange
          </button>
          {dirty && (
            <>
              <button
                type="button"
                onClick={save}
                className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={2} />
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowSaveAs(true)}
                className="kb-glass-sm kb-btn-glow flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                Save As
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="kb-glass-sm kb-btn-glow flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Create workflow
          </button>
          {workflow && (
            <button
              type="button"
              onClick={deleteWorkflow}
              className="kb-glass-sm kb-btn-glow flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-rose-300 hover:text-rose-200"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Create workflow form */}
      {showCreate && (
        <div className="kb-glass flex items-center gap-3 rounded-2xl p-3">
          <input
            type="text"
            aria-label="Workflow name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workflow name"
            className="flex-1 rounded-xl border-0 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <button
            type="button"
            onClick={() => createWorkflow(newName)}
            className="kb-gradient rounded-xl px-4 py-2 text-sm font-semibold text-white"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="kb-glass-sm rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Save As form */}
      {showSaveAs && (
        <div className="kb-glass flex items-center gap-3 rounded-2xl p-3">
          <input
            type="text"
            aria-label="New workflow name"
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder="New workflow name"
            className="flex-1 rounded-xl border-0 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <button
            type="button"
            onClick={() => saveAs(saveAsName)}
            className="kb-gradient rounded-xl px-4 py-2 text-sm font-semibold text-white"
          >
            Save As
          </button>
          <button
            type="button"
            onClick={() => setShowSaveAs(false)}
            className="kb-glass-sm rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main area: palette + canvas + inspector */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Node palette */}
        <div className="kb-glass flex w-40 shrink-0 flex-col gap-2 rounded-2xl p-3">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Add node</p>
          {(Object.keys(NODE_META) as WorkflowNodeType[]).map((type) => {
            const meta = NODE_META[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => addNode(type)}
                className="kb-glass-sm flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                {meta.label}
              </button>
            );
          })}
          <div className="mt-auto rounded-xl bg-white/5 p-2.5 text-[10px] leading-relaxed text-slate-500">
            <MousePointer2 className="mb-1 h-3.5 w-3.5 text-indigo-300" strokeWidth={2} />
            Drag a node to move it. Drag from an output port (right) to an input port (left) to connect.
          </div>
        </div>

        {/* Canvas */}
        <div className="kb-glass relative min-h-0 flex-1 overflow-auto rounded-2xl">
          <svg
            ref={svgRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="block touch-none select-none"
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerLeave={onSvgPointerUp}
          >
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#818cf8" />
              </marker>
              <marker id="wf-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
              </marker>
            </defs>

            {/* Edges — active state comes from the engine's routing. */}
            {edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              const isEngineActive = activeEdges.has(edge.id);
              const isSelected = edge.id === selectedEdgeId;
              const isLoop = loopEdgeSet.has(edge.id);
              const stroke = isEngineActive ? "#34d399" : isSelected ? "#a5b4fc" : isLoop ? "#d946ef" : "#818cf8";
              const { index: portIndex, count: portCount } = portIndexForEdge(edge);
              return (
                <g key={edge.id}>
                  <path
                    d={edgePath(from, to, portIndex, portCount)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isEngineActive || isSelected ? 2.5 : 1.75}
                    strokeDasharray={isLoop ? "7 5" : undefined}
                    markerEnd={isEngineActive ? "url(#wf-arrow-active)" : "url(#wf-arrow)"}
                    className="cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeId(null);
                    }}
                  />
                  <text
                    x={(from.x + NODE_W + to.x) / 2}
                    y={(from.y + to.y) / 2 + NODE_H / 2 - 6}
                    textAnchor="middle"
                    className={`text-[10px] ${isEngineActive ? "fill-emerald-300" : isLoop ? "fill-fuchsia-300" : "fill-slate-400"}`}
                  >
                    {edge.name || CONDITION_OPTIONS.find((c) => c.value === edge.condition)?.label}
                  </text>
                </g>
              );
            })}

            {/* Pending edge (while dragging) */}
            {pendingEdge && (() => {
              const from = nodeById.get(pendingEdge.from);
              if (!from) return null;
              const sx = from.x + NODE_W;
              const sy = from.y + NODE_H / 2;
              const dx = Math.max(50, (pendingEdge.x - sx) / 2);
              return (
                <path
                  d={`M ${sx} ${sy} C ${sx + dx} ${sy}, ${pendingEdge.x - dx} ${pendingEdge.y}, ${pendingEdge.x} ${pendingEdge.y}`}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              );
            })()}

            {/* Nodes — active state comes from the engine's routing. */}
            {nodes.map((node) => {
              const meta = NODE_META[node.type];
              const Icon = meta.icon;
              const isSelected = node.id === selectedNodeId;
              const isEngineActive = activeNodes.has(node.id);
              const exec = nodeExecState(node, openHandsState);
              const execMeta = EXEC_META[exec];
              const ExecIcon = execMeta.icon;
              const isDragSource = pendingEdge?.from === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                  onPointerUp={onNodeDragEnd}
                >
                  {/* Node body */}
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={14}
                    fill={isSelected ? "rgba(99,102,241,0.18)" : isEngineActive ? "rgba(52,211,153,0.12)" : "rgba(15,23,42,0.85)"}
                    stroke={isSelected ? "#818cf8" : isEngineActive ? "#34d399" : "rgba(148,163,184,0.25)"}
                    strokeWidth={isSelected || isEngineActive ? 2 : 1}
                  />
                  {/* Accent bar */}
                  <rect x={0} y={10} width={3} height={NODE_H - 20} rx={1.5} fill={meta.accent} />
                  {/* Type icon + label */}
                  <foreignObject x={14} y={10} width={NODE_W - 50} height={NODE_H - 20}>
                    <div className="flex h-full flex-col justify-center gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-slate-300" strokeWidth={2} />
                        <span className="truncate text-xs font-semibold text-white">{node.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ${meta.badge}`}>{meta.label}</span>
                        <span className="flex items-center gap-1 text-[9px] text-slate-400">
                          <ExecIcon className={`h-3 w-3 ${execMeta.spin ? "animate-spin" : ""}`} strokeWidth={2} />
                          {execMeta.label}
                        </span>
                      </div>
                    </div>
                  </foreignObject>
                  {/* Input port (left) */}
                  <circle
                    cx={0}
                    cy={NODE_H / 2}
                    r={PORT_R}
                    fill={pendingEdge && !isDragSource ? "#34d399" : "#0f172a"}
                    stroke={pendingEdge && !isDragSource ? "#34d399" : "#818cf8"}
                    strokeWidth={2}
                    className="cursor-crosshair"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => onInputPortPointerUp(e, node)}
                  />
                  {/* Output ports (right) — one per output port for multi-way nodes */}
                  {Array.from({ length: Math.max(1, node.outputPorts ?? 1) }).map((_, portIndex) => {
                    const portCount = Math.max(1, node.outputPorts ?? 1);
                    const portOffset = portCount > 1 ? (portIndex / (portCount - 1) - 0.5) * (NODE_H - 24) : 0;
                    return (
                      <circle
                        key={portIndex}
                        cx={NODE_W}
                        cy={NODE_H / 2 + portOffset}
                        r={PORT_R}
                        fill="#0f172a"
                        stroke={isDragSource && pendingEdge?.portIndex === portIndex ? "#34d399" : "#818cf8"}
                        strokeWidth={2}
                        className="cursor-crosshair"
                        onPointerDown={(e) => onOutputPortPointerDown(e, node, portIndex)}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Inspector */}
        {(selectedNode || selectedEdge) && (
          <div className="kb-glass flex w-64 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl p-4">
            {selectedNode && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Node</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${NODE_META[selectedNode.type].badge}`}>
                    {NODE_META[selectedNode.type].label}
                  </span>
                </div>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })}
                    className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  OpenHands profile
                  <select
                    value={selectedNode.profileId ?? ""}
                    onChange={(e) => updateNode(selectedNode.id, { profileId: e.target.value || null })}
                    className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value="" className="bg-slate-900">Unassigned</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id} className="bg-slate-900">
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedNode.taskId && taskById.get(selectedNode.taskId) && (
                  <div className="rounded-xl bg-white/5 p-2.5 text-[11px] text-slate-400">
                    <p className="font-semibold text-slate-300">Board task</p>
                    <p className="mt-0.5 truncate">{taskById.get(selectedNode.taskId)!.title}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">Status: {taskById.get(selectedNode.taskId)!.status}</p>
                  </div>
                )}
                <div className="rounded-xl bg-white/5 p-2.5 text-[11px] text-slate-400">
                  <p className="font-semibold text-slate-300">Execution</p>
                  <p className="mt-0.5">{EXEC_META[nodeExecState(selectedNode, openHandsState)].label}</p>
                </div>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Output ports (multi-way)
                  <select
                    value={selectedNode.outputPorts ?? 1}
                    onChange={(e) => updateNode(selectedNode.id, { outputPorts: Math.max(1, Number(e.target.value) || 1) })}
                    className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value={1} className="bg-slate-900">1 (single)</option>
                    <option value={2} className="bg-slate-900">2 (2-way)</option>
                    <option value={3} className="bg-slate-900">3 (3-way)</option>
                    <option value={4} className="bg-slate-900">4 (4-way)</option>
                    <option value={5} className="bg-slate-900">5 (N-way)</option>
                  </select>
                </label>
                <NodeSettings
                  node={selectedNode}
                  onPatch={(patch) => updateNode(selectedNode.id, { config: { ...selectedNode.config, ...patch } })}
                />
                <button
                  type="button"
                  onClick={() => deleteNode(selectedNode.id)}
                  className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-500/25"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Delete node
                </button>
              </>
            )}
            {selectedEdge && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Connection</h3>
                  <GitBranch className="h-4 w-4 text-indigo-300" strokeWidth={2} />
                </div>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Name
                  <input
                    type="text"
                    value={selectedEdge.name ?? ""}
                    onChange={(e) => updateEdge(selectedEdge.id, { name: e.target.value })}
                    placeholder="e.g. Research Complete"
                    className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Condition
                  <select
                    value={selectedEdge.condition}
                    onChange={(e) => updateEdge(selectedEdge.id, { condition: e.target.value as EdgeCondition })}
                    className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    {CONDITION_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value} className="bg-slate-900">
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-xl bg-white/5 p-2.5 text-[11px] text-slate-400">
                  <p className="font-semibold text-slate-300">Branch type</p>
                  {(() => {
                    const branch = branchTypeForCondition(selectedEdge.condition);
                    const meta = BRANCH_META[branch];
                    const BranchIcon = meta.icon;
                    return (
                      <p className="mt-0.5 flex items-center gap-1.5 text-slate-200">
                        <BranchIcon className="h-3.5 w-3.5 text-indigo-300" strokeWidth={2} />
                        {meta.label}
                      </p>
                    );
                  })()}
                </div>
                <div className="rounded-xl bg-white/5 p-2.5 text-[11px] text-slate-400">
                  <p className="font-semibold text-slate-300">From → To</p>
                  <p className="mt-0.5 truncate">
                    {nodeById.get(selectedEdge.from)?.label ?? selectedEdge.from} → {nodeById.get(selectedEdge.to)?.label ?? selectedEdge.to}
                  </p>
                </div>
                {selectedEdge.condition === "IF_LOOP" && (
                  <div className="rounded-xl bg-fuchsia-500/10 p-2.5 text-[11px] text-slate-400 ring-1 ring-fuchsia-400/20">
                    <p className="font-semibold text-fuchsia-300">Loop limit</p>
                    <p className="mt-0.5">
                      {loopCounts[selectedEdge.id] ?? 0} / {selectedEdge.loopLimit ?? 10} iterations
                    </p>
                    <label className="mt-2 flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Max iterations
                      <input
                        type="number"
                        min={1}
                        value={selectedEdge.loopLimit ?? 10}
                        onChange={(e) => updateEdge(selectedEdge.id, { loopLimit: Math.max(1, Number(e.target.value) || 1) })}
                        className="rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </label>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => deleteEdge(selectedEdge.id)}
                  className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-500/25"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Delete connection
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Node-specific settings.
 *
 * Each node type exposes a different set of settings in the inspector. The
 * settings write into node.config (the type-specific WorkflowNodeConfig), so
 * they persist with the workflow and are read by the engine at runtime.
 * ------------------------------------------------------------------ */

function NodeSettings({ node, onPatch }: { node: WorkflowNode; onPatch: (patch: Partial<WorkflowNodeConfig>) => void }) {
  const config = node.config ?? {};
  const set = (patch: Partial<WorkflowNodeConfig>) => onPatch(patch);

  const field = (label: string, control: ReactNode) => (
    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {label}
      {control}
    </label>
  );
  const inputCls =
    "rounded-xl border-0 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50";

  switch (node.type) {
    case "agent":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Agent settings</p>
          {field("Prompt", (
            <textarea
              value={config.prompt ?? ""}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder="Instruction sent to the agent"
              className={`${inputCls} min-h-16 resize-y`}
            />
          ))}
          {field("Memory", (
            <select value={config.memory ?? "none"} onChange={(e) => set({ memory: e.target.value as "none" | "session" | "persistent" })} className={inputCls}>
              <option value="none" className="bg-slate-900">None</option>
              <option value="session" className="bg-slate-900">Session</option>
              <option value="persistent" className="bg-slate-900">Persistent</option>
            </select>
          ))}
          {field("Timeout (s)", (
            <input type="number" min={0} value={config.timeoutSeconds ?? 0} onChange={(e) => set({ timeoutSeconds: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} />
          ))}
          {field("Max retries", (
            <input type="number" min={0} value={config.retryPolicy?.maxAttempts ?? 0} onChange={(e) => set({ retryPolicy: { maxAttempts: Math.max(0, Number(e.target.value) || 0), backoff: config.retryPolicy?.backoff ?? "fixed", delaySeconds: config.retryPolicy?.delaySeconds ?? 5 } })} className={inputCls} />
          ))}
        </div>
      );
    case "condition":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Condition settings</p>
          {field("Expression", (
            <input type="text" value={config.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} placeholder="e.g. amount > 1000" className={inputCls} />
          ))}
          {config.validation && <p className="text-[11px] text-rose-300">{config.validation}</p>}
        </div>
      );
    case "approval":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">Approval settings</p>
          {field("Approver", (
            <input type="text" value={config.approver ?? ""} onChange={(e) => set({ approver: e.target.value })} placeholder="Profile or user" className={inputCls} />
          ))}
          {field("SLA (hours)", (
            <input type="number" min={0} value={config.slaHours ?? 0} onChange={(e) => set({ slaHours: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} />
          ))}
        </div>
      );
    case "delay":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Delay settings</p>
          {field("Duration (s)", (
            <input type="number" min={0} value={config.durationSeconds ?? 0} onChange={(e) => set({ durationSeconds: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} />
          ))}
          {field("Schedule", (
            <input type="text" value={config.schedule ?? ""} onChange={(e) => set({ schedule: e.target.value })} placeholder="ISO 8601 or cron" className={inputCls} />
          ))}
        </div>
      );
    case "loop":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300">Loop settings</p>
          {field("Max iterations", (
            <input type="number" min={1} value={config.maxIterations ?? 3} onChange={(e) => set({ maxIterations: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} />
          ))}
          {field("Guard expression", (
            <input type="text" value={config.loopCondition ?? ""} onChange={(e) => set({ loopCondition: e.target.value })} placeholder="Exit when false" className={inputCls} />
          ))}
        </div>
      );
    case "task":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">Task settings</p>
          {field("Description", (
            <textarea value={config.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="Task instructions" className={`${inputCls} min-h-16 resize-y`} />
          ))}
        </div>
      );
    default:
      return null;
  }
}
