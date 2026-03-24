import { useState, useMemo, useCallback, useRef } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  STATUSES,
  PRIORITIES,
  statusLabel,
  statusColor,
  priorityColor,
  buildClusterMaps,
  isClusterNode,
  parseRaci,
} from "../constants";

const statuses = Object.keys(STATUSES);
const priorities = Object.keys(PRIORITIES);

interface BoardViewProps {
  onNavigateToNode: (nodeId: string) => void;
  onAddNode?: (defaultWorkstream?: string, defaultClusterId?: string) => void;
}

interface DragState {
  nodeId: string;
  sourceWorkstream: string;
  sourceClusterId?: string;
}

export function BoardView({ onNavigateToNode, onAddNode }: BoardViewProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateNode = useGraphStore((s) => s.updateNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const removeEdge = useGraphStore((s) => s.removeEdge);

  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState("");

  // Drag-and-drop state
  const dragRef = useRef<DragState | null>(null);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // section key of drop zone

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  const workstreams = useMemo(() => {
    const ws = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) ws.add(n.workstream);
    }
    return Array.from(ws).sort();
  }, [nodes]);

  // Leaf nodes only (exclude cluster parents)
  const leafNodes = useMemo(
    () => nodes.filter((n) => !isClusterNode(n.id, childrenMap)),
    [nodes, childrenMap],
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // --- Drag-and-drop handlers ---

  function handleDragStart(e: React.DragEvent, node: Node, clusterId?: string) {
    dragRef.current = {
      nodeId: node.id,
      sourceWorkstream: node.workstream ?? "",
      sourceClusterId: clusterId,
    };
    setDragNodeId(node.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
  }

  function handleDragEnd() {
    dragRef.current = null;
    setDragNodeId(null);
    setDropTarget(null);
  }

  function handleDragOver(e: React.DragEvent, sectionKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== sectionKey) setDropTarget(sectionKey);
  }

  function handleDragLeave(e: React.DragEvent, sectionKey: string) {
    // Only clear if we're actually leaving the container (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as HTMLElement)) {
      if (dropTarget === sectionKey) setDropTarget(null);
    }
  }

  async function handleDrop(e: React.DragEvent, targetWorkstream: string, targetClusterId?: string) {
    e.preventDefault();
    setDropTarget(null);
    const drag = dragRef.current;
    if (!drag) return;

    const nodeId = drag.nodeId;
    const sourceWs = drag.sourceWorkstream;
    const sourceCluster = drag.sourceClusterId;
    dragRef.current = null;
    setDragNodeId(null);

    // If dropped in the same group, nothing to do (no persistent sort order)
    if (sourceWs === targetWorkstream && sourceCluster === targetClusterId) return;

    // Update workstream if changed
    if (sourceWs !== targetWorkstream) {
      updateNode(nodeId, { workstream: targetWorkstream });
      await patchNode(nodeId, "workstream", targetWorkstream);
    }

    // Update cluster membership if changed
    if (sourceCluster !== targetClusterId) {
      // Remove old parent_of edge
      if (sourceCluster) {
        const oldEdge = edges.find(
          (e) => e.sourceId === sourceCluster && e.targetId === nodeId && e.type === "parent_of"
        );
        if (oldEdge) {
          try {
            await api(`/edges/${oldEdge.id}`, { method: "DELETE" });
            removeEdge(oldEdge.id);
          } catch { /* api() handles errors */ }
        }
      }
      // Create new parent_of edge
      if (targetClusterId) {
        try {
          const edge = await api<Edge>("/edges", {
            method: "POST",
            body: JSON.stringify({
              source_id: targetClusterId,
              target_id: nodeId,
              type: "parent_of",
            }),
          });
          addEdge(edge);
        } catch { /* api() handles errors */ }
      }
    }
  }

  async function patchNode(id: string, field: string, value: unknown) {
    // Map camelCase to snake_case for API
    const apiFieldMap: Record<string, string> = {
      startDate: "start_date",
      endDate: "end_date",
      positionPinned: "position_pinned",
    };
    const apiField = apiFieldMap[field] ?? field;
    try {
      await api(`/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ [apiField]: value }),
      });
    } catch {
      // api() handles errors
    }
  }

  function handleFieldChange(nodeId: string, field: keyof Node, value: unknown) {
    updateNode(nodeId, { [field]: value } as Partial<Node>);
  }

  function handleFieldBlur(nodeId: string, field: string, value: unknown) {
    patchNode(nodeId, field, value);
  }

  async function handleSelectChange(nodeId: string, field: keyof Node, value: string) {
    updateNode(nodeId, { [field]: value } as Partial<Node>);
    await patchNode(nodeId, field, value);
  }

  async function handleDelete(nodeId: string) {
    try {
      await api(`/nodes/${nodeId}`, { method: "DELETE" });
      removeNode(nodeId);
      if (expandedCard === nodeId) setExpandedCard(null);
    } catch {
      // api() handles errors
    }
  }

  async function handleAddNode(workstream: string, clusterId?: string) {
    if (!addLabel.trim()) return;
    try {
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: addLabel.trim(),
          workstream,
          priority: "P2",
          status: "not_started",
        }),
      });
      addNode(node);

      // If adding inside a cluster, create parent_of edge
      if (clusterId) {
        const edge = await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({
            source_id: clusterId,
            target_id: node.id,
            type: "parent_of",
          }),
        });
        addEdge(edge);
      }

      setAddLabel("");
      setAddingIn(null);
    } catch {
      // api() handles errors
    }
  }

  function renderCard(node: Node, clusterId?: string) {
    const isExpanded = expandedCard === node.id;
    const raciData = parseRaci(node.raci);
    const isDragging = dragNodeId === node.id;

    return (
      <div
        key={node.id}
        draggable
        onDragStart={(e) => handleDragStart(e, node, clusterId)}
        onDragEnd={handleDragEnd}
        style={{
          ...cardStyle,
          opacity: isDragging ? 0.4 : 1,
          cursor: "grab",
        }}
      >
        {/* Left accent bar */}
        <div style={{ width: 4, borderRadius: "4px 0 0 4px", background: priorityColor(node.priority), flexShrink: 0 }} />

        <div style={{ flex: 1, padding: "10px 12px", minWidth: 0 }}>
          {/* Top row — clickable to toggle expand */}
          <div
            style={{ cursor: "pointer" }}
            onClick={() => setExpandedCard(isExpanded ? null : node.id)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {node.name}
              </span>
              <span style={{ ...chipStyle, background: priorityColor(node.priority) + "18", color: priorityColor(node.priority) }}>
                {node.priority}
              </span>
              <span style={{ ...chipStyle, background: statusColor(node.status) + "18", color: statusColor(node.status) }}>
                {statusLabel(node.status)}
              </span>
              {raciData.responsible && (
                <span style={{ fontSize: 10, color: "#666", letterSpacing: 0.3 }}>
                  {raciData.responsible}
                </span>
              )}
            </div>
          </div>

          {/* Expanded body */}
          {isExpanded && (
            <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
              {/* Notes */}
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Notes</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                  value={node.notes ?? ""}
                  placeholder="Freeform notes, links, context..."
                  onChange={(e) => handleFieldChange(node.id, "notes", e.target.value)}
                  onBlur={(e) => handleFieldBlur(node.id, "notes", e.target.value)}
                />
              </div>

              {/* Deliverable */}
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Deliverables</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 40, resize: "vertical" }}
                  value={node.deliverable ?? ""}
                  placeholder="What does done look like?"
                  onChange={(e) => handleFieldChange(node.id, "deliverable", e.target.value)}
                  onBlur={(e) => handleFieldBlur(node.id, "deliverable", e.target.value)}
                />
              </div>

              {/* Status / Priority / Owner / Budget row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={labelStyle}>Status</label>
                  <select
                    style={inputStyle}
                    value={node.status}
                    onChange={(e) => handleSelectChange(node.id, "status", e.target.value)}
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select
                    style={inputStyle}
                    value={node.priority}
                    onChange={(e) => handleSelectChange(node.id, "priority", e.target.value)}
                  >
                    {priorities.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Budget</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={node.budget ?? ""}
                    onChange={(e) => handleFieldChange(node.id, "budget", e.target.value ? Number(e.target.value) : null)}
                    onBlur={(e) => handleFieldBlur(node.id, "budget", e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Workstream</label>
                  <input
                    style={inputStyle}
                    value={node.workstream ?? ""}
                    onChange={(e) => handleFieldChange(node.id, "workstream", e.target.value)}
                    onBlur={(e) => handleFieldBlur(node.id, "workstream", e.target.value)}
                  />
                </div>
              </div>

              {/* Dates row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Start Date</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={node.startDate ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      handleFieldChange(node.id, "startDate", val);
                      patchNode(node.id, "startDate", val);
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>End Date</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={node.endDate ?? ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      handleFieldChange(node.id, "endDate", val);
                      patchNode(node.id, "endDate", val);
                    }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btnStyle} onClick={() => onNavigateToNode(node.id)}>
                  VIEW IN GRAPH
                </button>
                <button style={{ ...btnStyle, background: "#dc2626" }} onClick={() => handleDelete(node.id)}>
                  DELETE
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderAddRow(sectionKey: string, workstream: string, clusterId?: string) {
    if (onAddNode) {
      return (
        <div style={addRowStyle} onClick={() => onAddNode(workstream, clusterId)}>
          <span style={{ color: "#BBB", fontWeight: 600, fontSize: 14 }}>+</span>
          <span style={{ color: "#BBB", fontSize: 10, letterSpacing: 1 }}>Add item</span>
        </div>
      );
    }
    if (addingIn === sectionKey) {
      return (
        <div style={addRowActiveStyle}>
          <span style={{ color: "#B81917", fontWeight: 600, fontSize: 14 }}>+</span>
          <input
            autoFocus
            style={{ flex: 1, ...inputStyle, fontSize: 12 }}
            placeholder="New item name..."
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddNode(workstream, clusterId);
              if (e.key === "Escape") { setAddingIn(null); setAddLabel(""); }
            }}
          />
          <button style={{ ...btnStyle, padding: "4px 10px", fontSize: 8 }} onClick={() => handleAddNode(workstream, clusterId)}>
            ADD
          </button>
          <button style={{ ...btnStyle, padding: "4px 10px", fontSize: 8, background: "#414042" }} onClick={() => { setAddingIn(null); setAddLabel(""); }}>
            ESC
          </button>
        </div>
      );
    }
    return (
      <div style={addRowStyle} onClick={() => { setAddingIn(sectionKey); setAddLabel(""); }}>
        <span style={{ color: "#BBB", fontWeight: 600, fontSize: 14 }}>+</span>
        <span style={{ color: "#BBB", fontSize: 10, letterSpacing: 1 }}>Add item</span>
      </div>
    );
  }

  // Workstream color — derive from a simple hash
  function wsColor(ws: string): string {
    const colors = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];
    let hash = 0;
    for (let i = 0; i < ws.length; i++) hash = ((hash << 5) - hash + ws.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", background: "#FAFAFA" }}>
      {workstreams.length === 0 && (
        <div style={{ textAlign: "center", color: "#999", padding: 40 }}>
          No workstreams found. Add nodes with a workstream to see them here.
        </div>
      )}
      {workstreams.map((ws) => {
        const color = wsColor(ws);
        const wsNodes = leafNodes.filter((n) => n.workstream === ws);
        const wsKey = `ws:${ws}`;
        const isWsCollapsed = collapsedSections.has(wsKey);

        // Clusters in this workstream
        const clusterIds = new Set<string>();
        for (const n of wsNodes) {
          const parent = parentMap.get(n.id);
          if (parent) clusterIds.add(parent);
        }
        const clusters = Array.from(clusterIds)
          .map((id) => nodes.find((n) => n.id === id))
          .filter(Boolean) as Node[];

        // Ungrouped nodes (no parent_of edge)
        const ungrouped = wsNodes.filter((n) => !parentMap.has(n.id));

        return (
          <div key={ws} style={{ marginBottom: 24 }}>
            {/* Workstream header */}
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}
              onClick={() => toggleSection(wsKey)}
            >
              <div style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 700, color, letterSpacing: 0.5, fontFamily: "Tomorrow, sans-serif" }}>
                {ws}
              </span>
              <span style={{ fontSize: 11, color: "#999" }}>{wsNodes.length} items</span>
              <span style={{ fontSize: 10, color: "#999", marginLeft: 4 }}>{isWsCollapsed ? "\u25B6" : "\u25BC"}</span>
            </div>

            {!isWsCollapsed && (
              <div style={{ marginLeft: 4 }}>
                {/* Cluster sub-groups */}
                {clusters.map((cluster) => {
                  const children = wsNodes.filter((n) => parentMap.get(n.id) === cluster.id);
                  if (!children.length) return null;
                  const subKey = `sub:${ws}/${cluster.id}`;
                  const isSubCollapsed = collapsedSections.has(subKey);
                  const clColor = priorityColor(cluster.priority) !== "#999" ? priorityColor(cluster.priority) : color;

                  return (
                    <div key={cluster.id} style={{ marginBottom: 12, borderLeft: `3px solid ${clColor}`, paddingLeft: 12 }}>
                      {/* Sub-group header */}
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 6 }}
                        onClick={() => toggleSection(subKey)}
                      >
                        <span style={{ fontSize: 10, color: "#999" }}>{isSubCollapsed ? "\u25B6" : "\u25BC"}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: clColor }}>{cluster.name}</span>
                        <span style={{ fontSize: 10, color: "#999", background: "#F0F0F0", borderRadius: 8, padding: "1px 6px" }}>
                          {children.length}
                        </span>
                      </div>
                      {!isSubCollapsed && (
                        <div
                          style={{
                            display: "flex", flexDirection: "column", gap: 4,
                            ...(dropTarget === subKey ? dropZoneHighlightStyle : {}),
                          }}
                          onDragOver={(e) => handleDragOver(e, subKey)}
                          onDragLeave={(e) => handleDragLeave(e, subKey)}
                          onDrop={(e) => handleDrop(e, ws, cluster.id)}
                        >
                          {children.map((n) => renderCard(n, cluster.id))}
                          {renderAddRow(subKey, ws, cluster.id)}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Ungrouped / Other */}
                {ungrouped.length > 0 && clusters.length > 0 && (
                  <div style={{ marginBottom: 12, borderLeft: "3px solid #999", paddingLeft: 12 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 6 }}
                      onClick={() => toggleSection(`other:${ws}`)}
                    >
                      <span style={{ fontSize: 10, color: "#999" }}>{collapsedSections.has(`other:${ws}`) ? "\u25B6" : "\u25BC"}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#777" }}>Other</span>
                      <span style={{ fontSize: 10, color: "#999", background: "#F0F0F0", borderRadius: 8, padding: "1px 6px" }}>
                        {ungrouped.length}
                      </span>
                    </div>
                    {!collapsedSections.has(`other:${ws}`) && (
                      <div
                        style={{
                          display: "flex", flexDirection: "column", gap: 4,
                          ...(dropTarget === `other:${ws}` ? dropZoneHighlightStyle : {}),
                        }}
                        onDragOver={(e) => handleDragOver(e, `other:${ws}`)}
                        onDragLeave={(e) => handleDragLeave(e, `other:${ws}`)}
                        onDrop={(e) => handleDrop(e, ws)}
                      >
                        {ungrouped.map((n) => renderCard(n))}
                      </div>
                    )}
                  </div>
                )}

                {/* If no clusters, just list ungrouped directly */}
                {clusters.length === 0 && (
                  <div
                    style={{
                      display: "flex", flexDirection: "column", gap: 4,
                      ...(dropTarget === wsKey ? dropZoneHighlightStyle : {}),
                    }}
                    onDragOver={(e) => handleDragOver(e, wsKey)}
                    onDragLeave={(e) => handleDragLeave(e, wsKey)}
                    onDrop={(e) => handleDrop(e, ws)}
                  >
                    {ungrouped.map((n) => renderCard(n))}
                  </div>
                )}

                {/* Add row at workstream level */}
                {renderAddRow(wsKey, ws)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Styles ---

const chipStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.5px",
  whiteSpace: "nowrap",
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  background: "#fff",
  borderRadius: 6,
  border: "1px solid #E7E7E7",
  overflow: "hidden",
  transition: "box-shadow 0.15s",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#FAFAFA",
  border: "1px solid #E7E7E7",
  borderRadius: 4,
  fontFamily: "Tomorrow, sans-serif",
  fontSize: 11,
  color: "#1A1A1A",
  outline: "none",
  width: "100%",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#999",
  letterSpacing: 0.5,
  display: "block",
  marginBottom: 2,
  textTransform: "uppercase",
};

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#B81917",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 9,
  fontWeight: 600,
  fontFamily: "Tomorrow, sans-serif",
  letterSpacing: 0.5,
};

const addRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  border: "1px dashed #DDD",
  borderRadius: 6,
  cursor: "pointer",
  marginTop: 4,
};

const addRowActiveStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  border: "1px solid #B81917",
  borderRadius: 6,
  marginTop: 4,
};

const dropZoneHighlightStyle: React.CSSProperties = {
  background: "rgba(184, 25, 23, 0.06)",
  borderRadius: 6,
  outline: "2px dashed #B81917",
  outlineOffset: 2,
  transition: "background 0.15s, outline 0.15s",
};
