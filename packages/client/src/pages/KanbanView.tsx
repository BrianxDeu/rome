import { useState, useMemo, useRef, useCallback } from "react";
import { useGraphStore } from "../stores/graphStore";
import { buildClusterMaps, isClusterNode, parseRaci, statusColor } from "../constants";
import type { Node, Edge } from "@rome/shared";
import { api } from "../api";

const KANBAN_STATUSES = ["not_started", "in_progress", "blocked", "done"] as const;
const KANBAN_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

export function KanbanView() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);

  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [selectedNg, setSelectedNg] = useState<string | null>(null); // null = "All Tasks"

  const dragRef = useRef<{ id: string; status: string } | null>(null);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Derive workstreams: top-level nodes with no parent and no workstream field (ws headers)
  const wsHeaders = useMemo(() => {
    return nodes
      .filter((n) => !parentMap.has(n.id) && !n.workstream && !n.archivedAt)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [nodes, parentMap]);

  // For the selected workstream, find its node groups (direct children that have children themselves)
  const nodeGroups = useMemo(() => {
    if (!selectedWs) return [];
    const wsHeader = wsHeaders.find((h) => h.name === selectedWs);
    if (!wsHeader) return [];
    const directChildren = childrenMap.get(wsHeader.id) ?? [];
    return directChildren
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is Node => !!n && !n.archivedAt)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [selectedWs, wsHeaders, childrenMap, nodes]);

  // Get leaf nodes for the selected workstream, optionally filtered by node group
  const leafNodes = useMemo(() => {
    if (!selectedWs) return [];
    return nodes.filter((n) => {
      if (n.archivedAt) return false;
      if (n.status === "cancelled") return false;
      if (n.workstream !== selectedWs) return false;
      // Must be a leaf: has a parent and no children
      if (!parentMap.has(n.id)) return false;
      if (isClusterNode(n.id, childrenMap)) return false;
      // Filter by node group if one is selected
      if (selectedNg) {
        const parent = parentMap.get(n.id);
        if (parent !== selectedNg) return false;
      }
      return true;
    });
  }, [nodes, selectedWs, selectedNg, parentMap, childrenMap]);

  // Sort leaf nodes: by kanbanSortOrder if set, then alphabetically by name
  const sortedLeaves = useMemo(() => {
    return [...leafNodes].sort((a, b) => {
      const aOrder = a.kanbanSortOrder;
      const bOrder = b.kanbanSortOrder;
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [leafNodes]);

  // Group sorted leaves by status
  const columns = useMemo(() => {
    const map: Record<string, Node[]> = {};
    for (const s of KANBAN_STATUSES) map[s] = [];
    for (const n of sortedLeaves) {
      if (map[n.status]) map[n.status].push(n);
    }
    return map;
  }, [sortedLeaves]);

  // Find node group name for a given node
  function nodeGroupName(node: Node): string {
    const parentId = parentMap.get(node.id);
    if (!parentId) return "";
    const parent = nodes.find((n) => n.id === parentId);
    return parent?.name ?? "";
  }

  function onDragStart(e: React.DragEvent, nodeId: string, status: string) {
    dragRef.current = { id: nodeId, status };
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).classList.add("dragging");
  }

  function onDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    // Clear any lingering drag-over indicators (handles cancelled drags / Escape key)
    document.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    dragRef.current = null;
  }

  const refetchGraph = useCallback(async () => {
    try {
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) {
      console.error("Failed to refetch graph:", err);
    }
  }, [setNodes, setEdges]);

  function onCardDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragRef.current) return;
    e.dataTransfer.dropEffect = "move";
    const el = e.currentTarget as HTMLElement;
    el.classList.remove("drag-over-top", "drag-over-bottom");
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    el.classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  }

  function onCardDragLeave(e: React.DragEvent) {
    const el = e.currentTarget as HTMLElement;
    el.classList.remove("drag-over-top", "drag-over-bottom");
  }

  function onColumnDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragRef.current) return;
    e.dataTransfer.dropEffect = "move";
  }

  async function onColumnDrop(e: React.DragEvent, targetStatus: string) {
    e.preventDefault();
    if (!dragRef.current) return;
    const { id, status: sourceStatus } = dragRef.current;
    dragRef.current = null;

    // Clear all drag-over classes
    e.currentTarget.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });

    if (sourceStatus === targetStatus) return;

    // Optimistic update
    updateNode(id, { status: targetStatus });

    // Persist
    try {
      await api(`/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: targetStatus }),
      });
    } catch (err) {
      console.error("Failed to update status:", err);
      // Revert on failure
      updateNode(id, { status: sourceStatus });
    }
  }

  async function onCardDrop(e: React.DragEvent, targetNodeId: string, targetStatus: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragRef.current) return;
    // Capture and clear ref immediately to avoid Firefox race where dragEnd fires after drop
    const { id: dragId, status: sourceStatus } = dragRef.current;
    dragRef.current = null;

    const el = e.currentTarget as HTMLElement;
    const dropAbove = el.classList.contains("drag-over-top");
    el.classList.remove("drag-over-top", "drag-over-bottom");

    if (dragId === targetNodeId) return;

    // If different column, it's a status change + reorder
    const isStatusChange = sourceStatus !== targetStatus;

    // Read current store state (not closed-over `columns`) to avoid stale data from concurrent socket updates
    const currentNodes = useGraphStore.getState().nodes;
    const currentEdges = useGraphStore.getState().edges;
    const { parentMap: currentParentMap, childrenMap: currentChildrenMap } = buildClusterMaps(currentEdges);
    const currentColumn = currentNodes.filter((n) => {
      if (n.archivedAt || n.status === "cancelled" || n.status !== targetStatus) return false;
      if (!currentParentMap.has(n.id)) return false;
      if (isClusterNode(n.id, currentChildrenMap)) return false;
      if (selectedNg) return currentParentMap.get(n.id) === selectedNg;
      if (selectedWs) return n.workstream === selectedWs;
      return true;
    }).sort((a, b) => {
      const aO = a.kanbanSortOrder, bO = b.kanbanSortOrder;
      if (aO != null && bO != null) return aO - bO;
      if (aO != null) return -1;
      if (bO != null) return 1;
      return a.name.localeCompare(b.name);
    });

    // Get current column's cards in order
    const columnCards = currentColumn.filter((n) => n.id !== dragId);

    // Find target index
    const targetIdx = columnCards.findIndex((n) => n.id === targetNodeId);
    const insertIdx = dropAbove ? targetIdx : targetIdx + 1;

    // Build the dragged node (may need status update)
    const dragNode = nodes.find((n) => n.id === dragId);
    if (!dragNode) return;

    // Insert the dragged node at the right position
    columnCards.splice(insertIdx, 0, dragNode);

    // Assign kanbanSortOrder values with gap-of-10
    const updates: { id: string; kanbanSortOrder: number; status?: string }[] = [];
    for (let i = 0; i < columnCards.length; i++) {
      const newOrder = (i + 1) * 10;
      const card = columnCards[i];
      if (card.id === dragId) {
        updates.push({ id: card.id, kanbanSortOrder: newOrder, ...(isStatusChange ? { status: targetStatus } : {}) });
      } else if (card.kanbanSortOrder !== newOrder) {
        updates.push({ id: card.id, kanbanSortOrder: newOrder });
      }
    }

    // Optimistic updates
    for (const u of updates) {
      const patch: Partial<Node> = { kanbanSortOrder: u.kanbanSortOrder };
      if (u.status) patch.status = u.status;
      updateNode(u.id, patch);
    }

    // Persist all updates — on any failure, refetch to reconcile optimistic state
    let hadError = false;
    for (const u of updates) {
      const body: Record<string, unknown> = { kanban_sort_order: u.kanbanSortOrder };
      if (u.status) body.status = u.status;
      try {
        await api(`/nodes/${u.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } catch (err) {
        console.error(`Failed to update kanban order for ${u.id}:`, err);
        hadError = true;
      }
    }
    if (hadError) {
      await refetchGraph();
    }
  }

  function handleWsClick(wsName: string) {
    if (selectedWs === wsName) {
      setSelectedWs(null);
      setSelectedNg(null);
    } else {
      setSelectedWs(wsName);
      setSelectedNg(null);
    }
  }

  return (
    <div className="kanban-container">
      {/* Sidebar */}
      <div className="kanban-sidebar">
        <div className="kanban-sidebar-title">Workstreams</div>
        {wsHeaders.map((ws) => (
          <div key={ws.id}>
            <div
              className={`kanban-ws-item ${selectedWs === ws.name ? "selected" : ""}`}
              onClick={() => handleWsClick(ws.name)}
            >
              <span className="kanban-ws-arrow">
                {selectedWs === ws.name ? "▾" : "▸"}
              </span>
              {ws.name}
            </div>
            {selectedWs === ws.name && (
              <div className="kanban-ng-list">
                <div
                  className={`kanban-ng-item ${selectedNg === null ? "selected" : ""}`}
                  onClick={() => setSelectedNg(null)}
                >
                  All Tasks
                </div>
                {nodeGroups.map((ng) => (
                  <div
                    key={ng.id}
                    className={`kanban-ng-item ${selectedNg === ng.id ? "selected" : ""}`}
                    onClick={() => setSelectedNg(ng.id)}
                  >
                    {ng.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Main area */}
      {!selectedWs ? (
        <div className="kanban-empty-state">Select a workstream</div>
      ) : (
        <div className="kanban-columns">
          {KANBAN_STATUSES.map((status) => (
            <div className="kanban-column" key={status}>
              <div
                className="kanban-column-header"
                style={{ borderBottom: `2px solid ${statusColor(status)}` }}
              >
                <div
                  className="kanban-column-dot"
                  style={{ background: statusColor(status) }}
                />
                <span className="kanban-column-label">
                  {KANBAN_LABELS[status]}
                </span>
                <span className="kanban-column-count">
                  {columns[status].length}
                </span>
              </div>
              <div
                className="kanban-cards"
                onDragOver={onColumnDragOver}
                onDrop={(e) => onColumnDrop(e, status)}
              >
                {columns[status].map((node) => {
                  const raci = parseRaci(node.raci);
                  return (
                    <div
                      key={node.id}
                      className={`kanban-card status-${status}`}
                      draggable
                      onClick={() => selectNode(node)}
                      onDragStart={(e) => onDragStart(e, node.id, status)}
                      onDragEnd={onDragEnd}
                      onDragOver={onCardDragOver}
                      onDragLeave={onCardDragLeave}
                      onDrop={(e) => onCardDrop(e, node.id, status)}
                    >
                      <div className="kanban-card-name">{node.name}</div>
                      <div className="kanban-card-meta">
                        {raci.responsible && (
                          <span className="kanban-card-responsible">
                            {raci.responsible}
                          </span>
                        )}
                        <span className="kanban-card-group">
                          {nodeGroupName(node)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
