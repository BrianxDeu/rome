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
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";

const statuses = Object.keys(STATUSES);
const priorities = Object.keys(PRIORITIES);

// Workstream colors
const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

function wsColor(ws: string, all: string[]): string {
  const idx = all.indexOf(ws);
  return WS_PALETTE[idx >= 0 ? idx % WS_PALETTE.length : 0];
}

interface BoardViewProps {
  onNavigateToNode: (nodeId: string) => void;
  onAddNode?: (defaultWorkstream?: string, defaultClusterId?: string) => void;
}

export function BoardView({ onNavigateToNode, onAddNode }: BoardViewProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);
  const updateNode = useGraphStore((s) => s.updateNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const removeEdge = useGraphStore((s) => s.removeEdge);

  const [boardExpanded, setBoardExpanded] = useState<string | null>(null);
  const [boardCollapsed, setBoardCollapsed] = useState<Set<string>>(new Set());
  const [boardOrder, setBoardOrder] = useState<Record<string, string[]>>({});
  const [boardAddGroup, setBoardAddGroup] = useState<string | null>(null);
  const [boardAddLabel, setBoardAddLabel] = useState("");
  const boardDrag = useRef<{ id: string; section: string; clusterId?: string } | null>(null);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  const workstreams = useMemo(() => {
    const ws = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) ws.add(n.workstream);
    }
    return Array.from(ws).sort();
  }, [nodes]);

  const leafNodes = useMemo(
    () => nodes.filter((n) => !isClusterNode(n.id, childrenMap)),
    [nodes, childrenMap],
  );

  function toggleBoardSub(subId: string) {
    setBoardCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(subId)) n.delete(subId);
      else n.add(subId);
      return n;
    });
  }

  function getBoardOrder(sectionKey: string, nodeIds: string[]): string[] {
    const order = boardOrder[sectionKey];
    if (!order) return nodeIds;
    const ordered: string[] = [];
    order.forEach((id) => { if (nodeIds.includes(id)) ordered.push(id); });
    nodeIds.forEach((id) => { if (!ordered.includes(id)) ordered.push(id); });
    return ordered;
  }

  function onBoardDragStart(e: React.DragEvent, nodeId: string, sectionKey: string, clusterId?: string) {
    boardDrag.current = { id: nodeId, section: sectionKey, clusterId };
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).classList.add("dragging");
  }

  function onBoardDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    document.querySelectorAll(".drag-over-top,.drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    boardDrag.current = null;
  }

  function onBoardDragOver(e: React.DragEvent, nodeId: string) {
    e.preventDefault();
    if (!boardDrag.current || boardDrag.current.id === nodeId) return;
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    (e.currentTarget as HTMLElement).classList.remove("drag-over-top", "drag-over-bottom");
    (e.currentTarget as HTMLElement).classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  }

  function onBoardDragLeave(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("drag-over-top", "drag-over-bottom");
  }

  function onSectionDragOver(e: React.DragEvent) {
    if (!boardDrag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  async function onSectionDrop(e: React.DragEvent, sectionKey: string, clusterId?: string) {
    e.preventDefault();
    if (!boardDrag.current) return;
    const dragId = boardDrag.current.id;
    const sourceSection = boardDrag.current.section;
    const sourceClusterId = boardDrag.current.clusterId;

    if (sourceSection === sectionKey) return; // same section, ignore section-level drop

    try {
      // 1) Delete old parent_of edge
      if (sourceClusterId) {
        const oldEdge = edges.find(
          (ed) => ed.type === "parent_of" && ed.sourceId === sourceClusterId && ed.targetId === dragId,
        );
        if (oldEdge) {
          await api(`/edges/${oldEdge.id}`, { method: "DELETE" });
        }
      }
      // 2) Create new parent_of edge if dropping into a cluster
      if (clusterId) {
        await api("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: clusterId, target_id: dragId, type: "parent_of" }),
        });
      }
      // 3) Update workstream if different
      const targetWs = sectionKey.split("/")[0];
      const sourceWs = sourceSection.split("/")[0];
      if (targetWs !== sourceWs) {
        await api(`/nodes/${dragId}`, {
          method: "PATCH",
          body: JSON.stringify({ workstream: targetWs }),
        });
      }
      // 4) Refetch graph
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) { console.error("[BoardView]", err); }

    boardDrag.current = null;
  }

  async function onBoardDrop(e: React.DragEvent, targetId: string, sectionKey: string, targetClusterId?: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("drag-over-top", "drag-over-bottom");
    if (!boardDrag.current) return;
    const dragId = boardDrag.current.id;
    const sourceSection = boardDrag.current.section;
    const sourceClusterId = boardDrag.current.clusterId;
    if (dragId === targetId) return;

    const isCrossGroup = sourceSection !== sectionKey;

    if (isCrossGroup) {
      // Cross-group move: update parent_of edges via API
      try {
        // 1) Delete old parent_of edge if any
        if (sourceClusterId) {
          const oldEdge = edges.find(
            (ed) => ed.type === "parent_of" && ed.sourceId === sourceClusterId && ed.targetId === dragId,
          );
          if (oldEdge) {
            await api(`/edges/${oldEdge.id}`, { method: "DELETE" });
          }
        }
        // 2) Create new parent_of edge if dropping into a cluster (not ungrouped)
        if (targetClusterId) {
          await api("/edges", {
            method: "POST",
            body: JSON.stringify({ source_id: targetClusterId, target_id: dragId, type: "parent_of" }),
          });
        }
        // 3) Update workstream if moving to a different workstream
        const targetWs = sectionKey.split("/")[0];
        const sourceWs = sourceSection.split("/")[0];
        if (targetWs !== sourceWs) {
          await api(`/nodes/${dragId}`, {
            method: "PATCH",
            body: JSON.stringify({ workstream: targetWs }),
          });
        }
        // 4) Refetch graph for consistency
        const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
        setNodes(graph.nodes);
        setEdges(graph.edges);
      } catch (err) { console.error("[BoardView]", err); }
    } else {
      // Same-group reorder (existing logic)
      const wsKey = sectionKey.split("/")[0];
      const sectionNodes = leafNodes.filter((n) => n.workstream === wsKey);
      const filteredNodes = sectionKey.includes("/")
        ? sectionNodes.filter((n) => parentMap.get(n.id) === sectionKey.split("/")[1])
        : sectionNodes.filter((n) => !parentMap.has(n.id));
      const ids = getBoardOrder(sectionKey, filteredNodes.map((n) => n.id));

      const fromIdx = ids.indexOf(dragId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const insertAfter = e.clientY >= rect.top + rect.height / 2;
      const newIds = ids.filter((id) => id !== dragId);
      const insertIdx = newIds.indexOf(targetId) + (insertAfter ? 1 : 0);
      newIds.splice(insertIdx, 0, dragId);

      setBoardOrder((prev) => ({ ...prev, [sectionKey]: newIds }));
    }

    boardDrag.current = null;
  }

  async function patchNode(id: string, field: string, value: unknown) {
    const apiFieldMap: Record<string, string> = { startDate: "start_date", endDate: "end_date" };
    const apiField = apiFieldMap[field] ?? field;
    try {
      await api(`/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ [apiField]: value }) });
    } catch (err) { console.error("[BoardView]", err); }
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
      if (boardExpanded === nodeId) setBoardExpanded(null);
    } catch (err) { console.error("[BoardView]", err); }
  }

  async function boardAddCluster(workstream: string) {
    if (!boardAddLabel.trim()) return;
    try {
      // Find the workstream header node to use as parent
      const wsHeader = nodes.find((n) => isClusterNode(n.id, childrenMap) && n.workstream === workstream && !parentMap.has(n.id));
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: boardAddLabel.trim(),
          workstream,
          priority: "P1",
          status: "not_started",
        }),
      });
      if (wsHeader) {
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: wsHeader.id, target_id: node.id, type: "parent_of" }),
        });
      }
      // Refetch full graph for consistency
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setBoardAddLabel("");
      setBoardAddGroup(null);
    } catch (err) { console.error("[BoardView]", err); }
  }

  async function boardAddNode(workstream: string, clusterId?: string) {
    if (!boardAddLabel.trim()) return;
    try {
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: boardAddLabel.trim(),
          workstream,
          priority: "P2",
          status: "not_started",
        }),
      });
      if (clusterId) {
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: clusterId, target_id: node.id, type: "parent_of" }),
        });
      }
      // Refetch full graph so edges + nodes are consistent for buildClusterMaps
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setBoardAddLabel("");
      setBoardAddGroup(null);
      setBoardExpanded(node.id);
    } catch (err) {
      console.error("[boardAddNode] failed:", err);
    }
  }

  function renderCard(n: Node, sectionKey: string, clusterId?: string) {
    const isExp = boardExpanded === n.id;
    const sColor = statusColor(n.status);
    const pColor = priorityColor(n.priority);
    const raciData = parseRaci(n.raci);

    return (
      <Card
        key={n.id}
        className={`board-card flex-row gap-0 rounded-md py-0 ${isExp ? "expanded" : ""}`}
        draggable
        onDragStart={(e) => onBoardDragStart(e, n.id, sectionKey, clusterId)}
        onDragEnd={onBoardDragEnd}
        onDragOver={(e) => onBoardDragOver(e, n.id)}
        onDragLeave={onBoardDragLeave}
        onDrop={(e) => onBoardDrop(e, n.id, sectionKey, clusterId)}
        onClick={() => setBoardExpanded(isExp ? null : n.id)}
      >
        <div className="board-card-drag" onMouseDown={(e) => e.stopPropagation()}>&#8942;&#8942;</div>
        <div className="board-card-accent" style={{ background: pColor }} />
        <CardContent className="board-card-main flex-1 p-[10px_14px]">
          <div className="board-card-top">
            <div className="board-card-title">{n.name}</div>
            <div className="board-card-meta">
              <Badge variant="outline" className="font-[Tomorrow] text-[8px] tracking-[0.8px] uppercase" style={{ background: pColor + "18", color: pColor, borderColor: pColor + "30" }}>{n.priority}</Badge>
              <Badge variant="outline" className="font-[Tomorrow] text-[8px] tracking-[0.8px] uppercase" style={{ background: sColor + "18", color: sColor, borderColor: sColor + "30" }}>{statusLabel(n.status)}</Badge>
              {raciData.responsible && <span className="board-card-owner">{raciData.responsible}</span>}
            </div>
          </div>
          {isExp && (
            <div className="board-card-body" onClick={(e) => e.stopPropagation()}>
              <div className="dp-field">
                <Label className="dp-label">Notes</Label>
                <Textarea
                  className="font-[Tomorrow] text-[10px]"
                  value={n.notes ?? ""}
                  placeholder="Freeform notes, links, context..."
                  onChange={(e) => handleFieldChange(n.id, "notes", e.target.value)}
                  onBlur={(e) => handleFieldBlur(n.id, "notes", e.target.value)}
                />
              </div>
              <div className="dp-field" style={{ marginTop: 8 }}>
                <Label className="dp-label">Deliverables</Label>
                <Textarea
                  className="font-[Tomorrow] text-[10px]"
                  value={n.deliverable ?? ""}
                  placeholder="What does done look like?"
                  onChange={(e) => handleFieldChange(n.id, "deliverable", e.target.value)}
                  onBlur={(e) => handleFieldBlur(n.id, "deliverable", e.target.value)}
                />
              </div>
              <div className="board-card-fields">
                <div className="dp-field">
                  <Label className="dp-label">Status</Label>
                  <select className="dp-input" value={n.status} onChange={(e) => handleSelectChange(n.id, "status", e.target.value)}>
                    {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </div>
                <div className="dp-field">
                  <Label className="dp-label">Priority</Label>
                  <select className="dp-input" value={n.priority} onChange={(e) => handleSelectChange(n.id, "priority", e.target.value)}>
                    {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="dp-field">
                  <Label className="dp-label">Owner</Label>
                  <Input className="font-[Tomorrow] text-[11px]" value={raciData.responsible}
                    onChange={(e) => {
                      const next = { ...raciData, responsible: e.target.value };
                      handleFieldChange(n.id, "raci", JSON.stringify(next));
                    }}
                    onBlur={(e) => {
                      const next = { ...raciData, responsible: e.target.value };
                      handleFieldBlur(n.id, "raci", JSON.stringify(next));
                    }}
                  />
                </div>
                <div className="dp-field">
                  <Label className="dp-label">Budget</Label>
                  <Input type="number" className="font-[Tomorrow] text-[11px]" value={n.budget ?? ""}
                    onChange={(e) => handleFieldChange(n.id, "budget", e.target.value ? Number(e.target.value) : null)}
                    onBlur={(e) => handleFieldBlur(n.id, "budget", e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
              </div>
              <div className="board-card-fields" style={{ marginTop: 8 }}>
                <div className="dp-field">
                  <Label className="dp-label">Start</Label>
                  <Input type="date" className="font-[Tomorrow] text-[11px]" value={n.startDate ?? ""}
                    onChange={(e) => { handleFieldChange(n.id, "startDate", e.target.value || null); patchNode(n.id, "startDate", e.target.value || null); }}
                  />
                </div>
                <div className="dp-field">
                  <Label className="dp-label">End</Label>
                  <Input type="date" className="font-[Tomorrow] text-[11px]" value={n.endDate ?? ""}
                    onChange={(e) => { handleFieldChange(n.id, "endDate", e.target.value || null); patchNode(n.id, "endDate", e.target.value || null); }}
                  />
                </div>
                <div className="dp-field">
                  <Label className="dp-label">Workstream</Label>
                  <Input className="font-[Tomorrow] text-[11px]" value={n.workstream ?? ""}
                    onChange={(e) => handleFieldChange(n.id, "workstream", e.target.value)}
                    onBlur={(e) => handleFieldBlur(n.id, "workstream", e.target.value)}
                  />
                </div>
              </div>
              {/* Dependencies & Blockers */}
              {(() => {
                const depTypes = new Set(["blocks", "blocker", "depends_on", "sequence", "produces", "feeds", "shared"]);
                const incoming = edges.filter((e) => e.targetId === n.id && depTypes.has(e.type));
                const outgoing = edges.filter((e) => e.sourceId === n.id && depTypes.has(e.type));
                // Only show leaf nodes as dependency targets (not workstream headers or cluster parents)
                const candidateNodes = leafNodes.filter((nd) => nd.id !== n.id);
                return (
                  <div style={{ marginTop: 12 }}>
                    <Label className="dp-label" style={{ marginBottom: 6 }}>Dependencies &amp; Blockers</Label>
                    {incoming.map((e) => {
                      const src = nodes.find((nd) => nd.id === e.sourceId);
                      return (
                        <div key={e.id} className="dp-dep">
                          <span style={{ fontSize: 9 }}>{src?.name ?? "?"} <span style={{ color: e.type === "blocker" || e.type === "blocks" ? "#B81917" : "#f59e0b" }}>{e.type}</span> this</span>
                          <button onClick={async () => {
                            try { await api(`/edges/${e.id}`, { method: "DELETE" }); removeEdge(e.id); } catch (err) { console.error("[BoardView] remove edge:", err); }
                          }}>&times;</button>
                        </div>
                      );
                    })}
                    {outgoing.map((e) => {
                      const tgt = nodes.find((nd) => nd.id === e.targetId);
                      return (
                        <div key={e.id} className="dp-dep">
                          <span style={{ fontSize: 9 }}>this <span style={{ color: e.type === "blocker" || e.type === "blocks" ? "#B81917" : "#3B82F6" }}>{e.type}</span> {tgt?.name ?? "?"}</span>
                          <button onClick={async () => {
                            try { await api(`/edges/${e.id}`, { method: "DELETE" }); removeEdge(e.id); } catch (err) { console.error("[BoardView] remove edge:", err); }
                          }}>&times;</button>
                        </div>
                      );
                    })}
                    {incoming.length === 0 && outgoing.length === 0 && (
                      <div style={{ fontSize: 9, color: "#BBB", marginBottom: 4 }}>No dependencies yet</div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      <select className="dp-input" style={{ fontSize: 9 }} value="" onChange={async (ev) => {
                        const targetId = ev.target.value;
                        if (!targetId) return;
                        try {
                          const edge = await api<Edge>("/edges", {
                            method: "POST",
                            body: JSON.stringify({ source_id: targetId, target_id: n.id, type: "depends_on" }),
                          });
                          addEdge(edge);
                          const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
                          setNodes(graph.nodes);
                          setEdges(graph.edges);
                        } catch (err) { console.error("[BoardView] add dep:", err); }
                        ev.target.value = "";
                      }}>
                        <option value="">+ Add dependency...</option>
                        {candidateNodes.map((nd) => <option key={`d-${nd.id}`} value={nd.id}>{nd.name}</option>)}
                      </select>
                      <select className="dp-input" style={{ fontSize: 9 }} value="" onChange={async (ev) => {
                        const targetId = ev.target.value;
                        if (!targetId) return;
                        try {
                          const edge = await api<Edge>("/edges", {
                            method: "POST",
                            body: JSON.stringify({ source_id: n.id, target_id: targetId, type: "blocker" }),
                          });
                          addEdge(edge);
                          const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
                          setNodes(graph.nodes);
                          setEdges(graph.edges);
                        } catch (err) { console.error("[BoardView] add blocker:", err); }
                        ev.target.value = "";
                      }}>
                        <option value="">+ Add blocker (outgoing)...</option>
                        {candidateNodes.map((nd) => <option key={`b-${nd.id}`} value={nd.id}>{nd.name}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Button variant="destructive" size="xs" className="font-[Tomorrow] text-[8px] tracking-[1px] uppercase" onClick={() => { handleDelete(n.id); setBoardExpanded(null); }}>DELETE</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderAddRow(workstream: string, clusterId?: string, isGroupAdd?: boolean) {
    const key = clusterId ? `${workstream}/${clusterId}` : workstream;
    const label = isGroupAdd ? "Add node group" : "Add node";
    const placeholder = isGroupAdd ? "New node group name..." : "New node name...";
    return boardAddGroup === key ? (
      <div className="board-add-row" style={{ borderStyle: "solid", borderColor: "#B81917" }} onClick={(e) => e.stopPropagation()}>
        <span style={{ color: "#B81917", fontWeight: 600, fontSize: 14 }}>+</span>
        <input
          autoFocus
          placeholder={placeholder}
          value={boardAddLabel}
          onChange={(e) => setBoardAddLabel(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              if (isGroupAdd) boardAddCluster(workstream);
              else boardAddNode(workstream, clusterId);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setBoardAddGroup(null);
              setBoardAddLabel("");
            }
          }}
        />
        <button className="btn" type="button" onClick={() => {
          if (isGroupAdd) boardAddCluster(workstream);
          else boardAddNode(workstream, clusterId);
        }}>ADD</button>
        <button className="btn" type="button" onClick={() => { setBoardAddGroup(null); setBoardAddLabel(""); }}>ESC</button>
      </div>
    ) : (
      <div className="board-add-row" onClick={() => setBoardAddGroup(key)}>
        <span style={{ color: "#BBB", fontWeight: 600, fontSize: 14 }}>+</span>
        <span style={{ color: "#BBB", fontSize: 10, letterSpacing: 1 }}>{label}</span>
      </div>
    );
  }

  return (
    <div className="board-wrap">
      {workstreams.length === 0 && (
        <div style={{ textAlign: "center", color: "#999", padding: 40 }}>
          No workstreams found. Add nodes with a workstream to see them here.
        </div>
      )}
      {workstreams.map((ws) => {
        const color = wsColor(ws, workstreams);
        const allGroupNodes = leafNodes.filter((n) => n.workstream === ws);
        // Find clusters in this workstream
        const clusterIds = new Set<string>();
        for (const n of allGroupNodes) {
          const parent = parentMap.get(n.id);
          if (parent) clusterIds.add(parent);
        }
        const clusters = Array.from(clusterIds)
          .map((id) => nodes.find((n) => n.id === id))
          .filter(Boolean) as Node[];
        const ungrouped = allGroupNodes.filter((n) => !parentMap.has(n.id));
        const ungroupedKey = ws + "/_ungrouped";

        return (
          <div key={ws} className="board-group">
            <div className="board-group-header">
              <div style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
              <div className="board-group-label" style={{ color }}>{ws}</div>
              <div className="board-group-count">{allGroupNodes.length} items</div>
            </div>
            <div className="board-cards">
              {clusters.map((cluster) => {
                const children = allGroupNodes.filter((n) => parentMap.get(n.id) === cluster.id);
                if (!children.length) return null;
                const subKey = ws + "/" + cluster.id;
                const isSubCol = boardCollapsed.has(subKey);
                const orderedIds = getBoardOrder(subKey, children.map((n) => n.id));
                const orderedChildren = orderedIds.map((id) => children.find((n) => n.id === id)).filter(Boolean) as Node[];
                const clColor = priorityColor(cluster.priority) !== "#999" ? priorityColor(cluster.priority) : color;
                return (
                  <div key={cluster.id} className="board-subgroup">
                    <div className="board-subgroup-header" onClick={() => toggleBoardSub(subKey)} style={{ borderLeftColor: clColor, borderLeftWidth: 3 }}>
                      <div className="board-subgroup-toggle">{isSubCol ? "\u25B6" : "\u25BC"}</div>
                      <div className="board-subgroup-label" style={{ color: clColor }}>{cluster.name}</div>
                      <div className="board-subgroup-count">{children.length}</div>
                    </div>
                    {!isSubCol && (
                      <div
                        className="board-subgroup-cards"
                        onDragOver={onSectionDragOver}
                        onDrop={(e) => onSectionDrop(e, subKey, cluster.id)}
                      >
                        {orderedChildren.map((n) => renderCard(n, subKey, cluster.id))}
                        {renderAddRow(ws, cluster.id)}
                      </div>
                    )}
                  </div>
                );
              })}
              {ungrouped.length > 0 && clusters.length > 0 && (
                <div className="board-subgroup">
                  <div className="board-subgroup-header" onClick={() => toggleBoardSub(ungroupedKey)} style={{ borderLeftColor: "#999", borderLeftWidth: 3 }}>
                    <div className="board-subgroup-toggle">{boardCollapsed.has(ungroupedKey) ? "\u25B6" : "\u25BC"}</div>
                    <div className="board-subgroup-label" style={{ color: "#777" }}>Other</div>
                    <div className="board-subgroup-count">{ungrouped.length}</div>
                  </div>
                  {!boardCollapsed.has(ungroupedKey) && (
                    <div
                      className="board-subgroup-cards"
                      onDragOver={onSectionDragOver}
                      onDrop={(e) => onSectionDrop(e, ungroupedKey)}
                    >
                      {getBoardOrder(ungroupedKey, ungrouped.map((n) => n.id)).map((id) => {
                        const n = ungrouped.find((nd) => nd.id === id);
                        return n ? renderCard(n, ungroupedKey) : null;
                      })}
                    </div>
                  )}
                </div>
              )}
              {ungrouped.length > 0 && clusters.length === 0 && (
                <div
                  onDragOver={onSectionDragOver}
                  onDrop={(e) => onSectionDrop(e, ungroupedKey)}
                >
                  {getBoardOrder(ungroupedKey, ungrouped.map((n) => n.id)).map((id) => {
                    const n = ungrouped.find((nd) => nd.id === id);
                    return n ? renderCard(n, ungroupedKey) : null;
                  })}
                </div>
              )}
              {renderAddRow(ws, undefined, true)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
