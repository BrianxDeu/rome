import { useCallback, useState, useRef, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";

// --- NodeDot custom node ---

const statusColors: Record<string, string> = {
  not_started: "#999",
  in_progress: "#2563eb",
  blocked: "#dc2626",
  done: "#16a34a",
  cancelled: "#9ca3af",
};

function NodeDot({ data }: NodeProps) {
  const color = statusColors[data.status as string] ?? "#999";
  const budget = data.budget as number | null;
  const size = budget
    ? Math.min(24, Math.max(8, 8 + Math.log10(budget + 1) * 3))
    : 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          cursor: "pointer",
        }}
      />
      <span
        style={{
          fontSize: 11,
          marginTop: 4,
          whiteSpace: "nowrap",
          color: "var(--rome-text, #1A1A1A)",
          textDecoration: data.status === "cancelled" ? "line-through" : "none",
          fontFamily: "Tomorrow, sans-serif",
        }}
      >
        {data.label as string}
      </span>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { nodeDot: NodeDot };

// --- Filter bar ---

function FilterBar() {
  const nodes = useGraphStore((s) => s.nodes);
  const filters = useGraphStore((s) => s.filters);
  const setFilter = useGraphStore((s) => s.setFilter);

  const workstreams = useMemo(
    () => [...new Set(nodes.map((n) => n.workstream).filter(Boolean))] as string[],
    [nodes],
  );

  const selectStyle = {
    padding: "4px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontFamily: "Tomorrow, sans-serif",
    fontSize: 13,
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid #e5e5e5",
        fontSize: 13,
        fontFamily: "Tomorrow, sans-serif",
      }}
    >
      <select
        value={filters.status ?? ""}
        onChange={(e) => setFilter("status", e.target.value || null)}
        style={selectStyle}
      >
        <option value="">All statuses</option>
        <option value="not_started">Not started</option>
        <option value="in_progress">In progress</option>
        <option value="blocked">Blocked</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      {workstreams.length > 0 && (
        <select
          value={(filters as any).workstream ?? ""}
          onChange={(e) => setFilter("type" as any, e.target.value || null)}
          style={selectStyle}
        >
          <option value="">All workstreams</option>
          {workstreams.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// --- Context menu ---

function ContextMenu({
  x,
  y,
  nodeId,
  onClose,
}: {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
}) {
  const statuses = ["not_started", "in_progress", "blocked", "done", "cancelled"];
  const priorities = ["P0", "P1", "P2", "P3"];

  async function setStatus(status: string) {
    await api(`/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    onClose();
  }

  async function setPriority(priority: string) {
    await api(`/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify({ priority }),
    });
    onClose();
  }

  async function deleteNode() {
    await api(`/nodes/${nodeId}`, { method: "DELETE" });
    onClose();
  }

  const btnStyle = {
    display: "block" as const,
    width: "100%",
    textAlign: "left" as const,
    padding: "4px 8px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "Tomorrow, sans-serif",
    fontSize: 13,
  };

  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: "#fff",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 4,
        zIndex: 100,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        minWidth: 160,
        fontFamily: "Tomorrow, sans-serif",
        fontSize: 13,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ padding: "4px 8px", fontWeight: 600, color: "#414042", fontSize: 11 }}>
        Status
      </div>
      {statuses.map((s) => (
        <button key={s} onClick={() => setStatus(s)} style={btnStyle}>
          {s.replace(/_/g, " ")}
        </button>
      ))}
      <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #eee" }} />
      <div style={{ padding: "4px 8px", fontWeight: 600, color: "#414042", fontSize: 11 }}>
        Priority
      </div>
      {priorities.map((p) => (
        <button key={p} onClick={() => setPriority(p)} style={btnStyle}>
          {p}
        </button>
      ))}
      <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #eee" }} />
      <button onClick={deleteNode} style={{ ...btnStyle, color: "#dc2626" }}>
        Delete
      </button>
    </div>
  );
}

// --- Main GraphView ---

function matchesFilter(node: Node, filters: { status: string | null }) {
  if (filters.status && node.status !== filters.status) return false;
  return true;
}

interface GraphViewProps {
  onNavigateToNode?: (nodeId: string) => void;
}

export function GraphView({ onNavigateToNode }: GraphViewProps) {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const filters = useGraphStore((s) => s.filters);
  const hasActiveFilter = filters.status || filters.type || filters.responsible;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const flowNodes: FlowNode[] = useMemo(
    () =>
      storeNodes.map((n) => ({
        id: n.id,
        type: "nodeDot",
        position: {
          x: n.x ?? Math.random() * 800,
          y: n.y ?? Math.random() * 600,
        },
        data: {
          label: n.name,
          status: n.status,
          budget: n.budget,
        },
        style: {
          opacity: hasActiveFilter && !matchesFilter(n, filters) ? 0.1 : 1,
        },
      })),
    [storeNodes, filters, hasActiveFilter],
  );

  const flowEdges: FlowEdge[] = useMemo(
    () =>
      storeEdges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        type: "default",
        style: {
          stroke: e.type === "blocks" ? "#dc2626" : "#999",
          strokeWidth: e.type === "blocks" ? 2 : 1,
        },
        animated: e.type === "blocks",
      })),
    [storeEdges],
  );

  const onNodeClick = useCallback(
    (_: any, node: FlowNode) => {
      const storeNode = storeNodes.find((n) => n.id === node.id) ?? null;
      selectNode(storeNode);
      setContextMenu(null);
    },
    [selectNode, storeNodes],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FlowNode) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  const onDoubleClick = useCallback(
    async (event: React.MouseEvent) => {
      const name = prompt("Node name:");
      if (!name) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const x = event.clientX - (bounds?.left ?? 0);
      const y = event.clientY - (bounds?.top ?? 0);
      await api("/nodes", {
        method: "POST",
        body: JSON.stringify({ name, x, y }),
      });
    },
    [],
  );

  const onConnect = useCallback(async (connection: Connection) => {
    if (connection.source && connection.target) {
      try {
        await api("/edges", {
          method: "POST",
          body: JSON.stringify({
            sourceId: connection.source,
            targetId: connection.target,
            type: "blocks",
          }),
        });
      } catch (e) {
        console.error("Failed to create edge:", e);
      }
    }
  }, []);

  const onNodeDragStop = useCallback(async (_: any, node: FlowNode) => {
    await api(`/nodes/${node.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        x: node.position.x,
        y: node.position.y,
        positionPinned: 1,
      }),
    });
  }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", flex: 1 }}>
      <FilterBar />
      <div ref={wrapperRef} style={{ flex: 1 }} onDoubleClick={onDoubleClick}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
