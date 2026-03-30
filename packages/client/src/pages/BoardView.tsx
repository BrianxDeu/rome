import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  STATUSES,
  PRIORITIES,
  EDGE_TYPES,
  statusLabel,
  statusColor,
  priorityColor,
  buildClusterMaps,
  isClusterNode,
  parseRaci,
} from "../constants";
import { isGoalNode } from "../utils/graphLayout";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";

const statuses = Object.keys(STATUSES);
const priorities = Object.keys(PRIORITIES);
const edgeTypes = Object.keys(EDGE_TYPES).filter((t) => t !== "parent_of");

// Workstream colors
const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

function wsColor(ws: string): string {
  // Derive color from name hash so it stays stable across reordering
  let hash = 0;
  for (let i = 0; i < ws.length; i++) {
    hash = ((hash << 5) - hash + ws.charCodeAt(i)) | 0;
  }
  return WS_PALETTE[((hash % WS_PALETTE.length) + WS_PALETTE.length) % WS_PALETTE.length];
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
  const selectNode = useGraphStore((s) => s.selectNode);

  const [boardExpanded, setBoardExpanded] = useState<string | null>(null);
  // Start with all node groups collapsed — use a sentinel to initialize once
  const [boardCollapsed, setBoardCollapsed] = useState<Set<string> | null>(null);
  const [boardOrder, setBoardOrder] = useState<Record<string, string[]>>({});
  const [boardAddGroup, setBoardAddGroup] = useState<string | null>(null);
  const [boardAddLabel, setBoardAddLabel] = useState("");
  const [collapsedWorkstreams, setCollapsedWorkstreams] = useState<Set<string> | null>(null);
  const boardDrag = useRef<{ id: string; section: string; clusterId?: string } | null>(null);
  const wsDrag = useRef<{ ws: string } | null>(null);
  const wsDragOccurred = useRef(false);
  const clusterDrag = useRef<{ id: string; ws: string } | null>(null);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Build a map of workstream name -> sort_order from ws header nodes
  const wsHeaderMap = useMemo(() => {
    const map = new Map<string, { sortOrder: number | null; headerId: string }>();
    for (const n of nodes) {
      if (!parentMap.has(n.id) && !isGoalNode(n) && n.name && !n.workstream) {
        map.set(n.name, { sortOrder: n.sortOrder, headerId: n.id });
      }
    }
    return map;
  }, [nodes, parentMap]);

  const workstreams = useMemo(() => {
    const ws = new Set<string>();
    // From leaf node workstream fields (existing pattern)
    for (const n of nodes) {
      if (n.workstream) ws.add(n.workstream);
    }
    // Also include top-level nodes with no parent as workstreams (ws header nodes)
    // These may be new empty workstreams or existing ones with children
    for (const n of nodes) {
      if (!parentMap.has(n.id) && !isGoalNode(n) && n.name) {
        ws.add(n.name);
      }
    }
    return Array.from(ws).sort((a, b) => {
      const aOrder = wsHeaderMap.get(a)?.sortOrder;
      const bOrder = wsHeaderMap.get(b)?.sortOrder;
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.localeCompare(b);
    });
  }, [nodes, parentMap, wsHeaderMap]);

  // Initialize collapsed workstreams: all except the first one
  useEffect(() => {
    if (collapsedWorkstreams === null && workstreams.length > 0) {
      setCollapsedWorkstreams(new Set(workstreams.slice(1)));
    }
  }, [workstreams, collapsedWorkstreams]);

  // A workstream header: no parent, no workstream field, has children (or was just created via +STREAM)
  // We check children OR the node's name appears in the workstream field of other nodes
  const wsFieldValues = useMemo(() => {
    const vals = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) vals.add(n.workstream);
    }
    return vals;
  }, [nodes]);

  const isWsHeader = useCallback(
    (n: Node) => {
      if (parentMap.has(n.id) || isGoalNode(n) || n.workstream) return false;
      // Has children → definitely a ws header
      if ((childrenMap.get(n.id)?.length ?? 0) > 0) return true;
      // Name matches a workstream field value on other nodes → ws header
      if (wsFieldValues.has(n.name)) return true;
      return false;
    },
    [parentMap, childrenMap, wsFieldValues],
  );

  // Identify node group IDs: direct children of ws headers (they're structural, not tasks)
  const nodeGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nodes) {
      if (isWsHeader(n)) {
        for (const childId of childrenMap.get(n.id) ?? []) {
          ids.add(childId);
        }
      }
    }
    return ids;
  }, [nodes, isWsHeader, childrenMap]);

  const leafNodes = useMemo(
    () => nodes.filter((n) => !isClusterNode(n.id, childrenMap) && !isWsHeader(n) && !nodeGroupIds.has(n.id)),
    [nodes, childrenMap, isWsHeader, nodeGroupIds],
  );

  function toggleBoardSub(subId: string) {
    setBoardCollapsed((prev) => {
      // If null (initial state = all collapsed), create set with just this one removed (= expanded)
      if (!prev) return new Set<string>(); // empty set = nothing explicitly collapsed, but we flip logic below
      const n = new Set(prev);
      if (n.has(subId)) n.delete(subId);
      else n.add(subId);
      return n;
    });
  }

  // Track which subgroups are EXPANDED (simpler than tracking collapsed)
  const [boardExpandedSubs, setBoardExpandedSubs] = useState<Set<string>>(new Set());
  function isSubCollapsed(subKey: string): boolean {
    return !boardExpandedSubs.has(subKey);
  }
  function toggleSub(subKey: string) {
    setBoardExpandedSubs((prev) => {
      const n = new Set(prev);
      if (n.has(subKey)) n.delete(subKey);
      else n.add(subKey);
      return n;
    });
  }

  // --- Inline rename via double-click + contentEditable ---
  async function renameNode(nodeId: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    updateNode(nodeId, { name: trimmed });
    try {
      await api(`/nodes/${nodeId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
    } catch (err) {
      console.error("Failed to rename node:", err);
    }
  }

  async function renameWorkstream(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    // Find the workstream header node (top-level, no workstream field, name matches)
    const wsHeader = nodes.find((n) => n.name === oldName && !parentMap.has(n.id) && !n.workstream);
    // Optimistically update the header node name
    if (wsHeader) {
      updateNode(wsHeader.id, { name: trimmed });
    }
    // Optimistically update workstream field on ALL child nodes
    const affected = nodes.filter((n) => n.workstream === oldName);
    for (const n of affected) {
      updateNode(n.id, { workstream: trimmed });
    }
    // Persist to DB — renaming the header node cascades workstream fields server-side
    try {
      if (wsHeader) {
        await api(`/nodes/${wsHeader.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: trimmed }),
        });
      } else {
        // No header node found — update workstream fields individually
        for (const n of affected) {
          await api(`/nodes/${n.id}`, {
            method: "PATCH",
            body: JSON.stringify({ workstream: trimmed }),
          });
        }
      }
      // Refetch for consistency
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) {
      console.error("Failed to rename workstream:", err);
    }
  }

  function handleEditableBlur(
    e: React.FocusEvent<HTMLDivElement>,
    onSave: (newText: string) => void,
    originalText: string,
  ) {
    const newText = (e.currentTarget.textContent ?? "").trim();
    if (newText && newText !== originalText) {
      onSave(newText);
    } else {
      e.currentTarget.textContent = originalText;
    }
  }

  function handleEditableKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Restore original — blur will handle it since text matches original
      e.currentTarget.blur();
    }
  }

  function getBoardOrder(sectionKey: string, nodeIds: string[]): string[] {
    // First check local override (for optimistic reorder before API responds)
    const order = boardOrder[sectionKey];
    if (order) {
      const ordered: string[] = [];
      order.forEach((id) => { if (nodeIds.includes(id)) ordered.push(id); });
      nodeIds.forEach((id) => { if (!ordered.includes(id)) ordered.push(id); });
      return ordered;
    }
    // Otherwise sort by sort_order from DB, falling back to original order
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    return [...nodeIds].sort((a, b) => {
      const aNode = nodeMap.get(a);
      const bNode = nodeMap.get(b);
      const aOrder = aNode?.sortOrder;
      const bOrder = bNode?.sortOrder;
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return 0; // preserve original order
    });
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

  function onWsDragStart(e: React.DragEvent, ws: string) {
    wsDrag.current = { ws };
    wsDragOccurred.current = true;
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).classList.add("dragging");
  }

  function onWsDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    document.querySelectorAll(".ws-drag-over-top,.ws-drag-over-bottom").forEach((el) => {
      el.classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
    });
    wsDrag.current = null;
  }

  function onWsDragOver(e: React.DragEvent, targetWs: string) {
    e.preventDefault();
    if (!wsDrag.current || wsDrag.current.ws === targetWs) return;
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    (e.currentTarget as HTMLElement).classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
    (e.currentTarget as HTMLElement).classList.add(e.clientY < mid ? "ws-drag-over-top" : "ws-drag-over-bottom");
  }

  function onWsDragLeave(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
  }

  async function onWsDrop(e: React.DragEvent, targetWs: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
    if (!wsDrag.current || wsDrag.current.ws === targetWs) return;

    const dragWs = wsDrag.current.ws;
    wsDrag.current = null;

    // Compute new order
    const currentOrder = [...workstreams];
    const fromIdx = currentOrder.indexOf(dragWs);
    const toIdx = currentOrder.indexOf(targetWs);
    if (fromIdx < 0 || toIdx < 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;

    const reordered = currentOrder.filter((w) => w !== dragWs);
    const insertIdx = reordered.indexOf(targetWs) + (insertAfter ? 1 : 0);
    reordered.splice(insertIdx, 0, dragWs);

    // Assign sort_order values with gaps of 10
    const patches: Array<{ id: string; sortOrder: number }> = [];
    for (let i = 0; i < reordered.length; i++) {
      const header = wsHeaderMap.get(reordered[i]);
      if (header) {
        patches.push({ id: header.headerId, sortOrder: (i + 1) * 10 });
      }
    }

    // Optimistic update: patch local store immediately
    for (const p of patches) {
      updateNode(p.id, { sortOrder: p.sortOrder });
    }

    // Persist to API
    try {
      await Promise.all(
        patches.map((p) =>
          api(`/nodes/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sort_order: p.sortOrder }),
          })
        )
      );
    } catch (err) {
      console.error("[BoardView] workstream reorder failed:", err);
      // Refetch to restore consistent state
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
  }

  // Node group (cluster) drag-reorder within a workstream
  function onClusterDragStart(e: React.DragEvent, clusterId: string, ws: string) {
    clusterDrag.current = { id: clusterId, ws };
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).classList.add("dragging");
    e.stopPropagation(); // prevent ws drag from firing
  }

  function onClusterDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    document.querySelectorAll(".cluster-drag-over-top,.cluster-drag-over-bottom").forEach((el) => {
      el.classList.remove("cluster-drag-over-top", "cluster-drag-over-bottom");
    });
    clusterDrag.current = null;
  }

  function onClusterDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!clusterDrag.current || clusterDrag.current.id === targetId) return;
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    (e.currentTarget as HTMLElement).classList.remove("cluster-drag-over-top", "cluster-drag-over-bottom");
    (e.currentTarget as HTMLElement).classList.add(e.clientY < mid ? "cluster-drag-over-top" : "cluster-drag-over-bottom");
  }

  function onClusterDragLeave(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("cluster-drag-over-top", "cluster-drag-over-bottom");
  }

  async function onClusterDrop(e: React.DragEvent, targetId: string, clustersList: Node[]) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("cluster-drag-over-top", "cluster-drag-over-bottom");
    if (!clusterDrag.current || clusterDrag.current.id === targetId) return;

    const dragId = clusterDrag.current.id;
    clusterDrag.current = null;

    const currentOrder = clustersList.map((c) => c.id);
    const fromIdx = currentOrder.indexOf(dragId);
    if (fromIdx < 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;
    const reordered = currentOrder.filter((id) => id !== dragId);
    const insertIdx = reordered.indexOf(targetId) + (insertAfter ? 1 : 0);
    reordered.splice(insertIdx, 0, dragId);

    // Persist sort_order
    const patches = reordered.map((id, i) => ({ id, sortOrder: (i + 1) * 10 }));
    for (const p of patches) {
      updateNode(p.id, { sortOrder: p.sortOrder });
    }
    try {
      await Promise.all(
        patches.map((p) =>
          api(`/nodes/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sort_order: p.sortOrder }),
          })
        )
      );
    } catch (err) {
      console.error("[BoardView] cluster reorder failed:", err);
    }
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
      // Same-group reorder: persist sort_order to DB
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

      // Optimistic local update
      setBoardOrder((prev) => ({ ...prev, [sectionKey]: newIds }));

      // Persist sort_order with gaps of 10
      const patches = newIds.map((id, i) => ({ id, sortOrder: (i + 1) * 10 }));
      for (const p of patches) {
        updateNode(p.id, { sortOrder: p.sortOrder });
      }
      try {
        await Promise.all(
          patches.map((p) =>
            api(`/nodes/${p.id}`, {
              method: "PATCH",
              body: JSON.stringify({ sort_order: p.sortOrder }),
            })
          )
        );
        // Clear local override now that DB has the order
        setBoardOrder((prev) => { const next = { ...prev }; delete next[sectionKey]; return next; });
      } catch (err) {
        console.error("[BoardView] card reorder failed:", err);
      }
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

  // Debounced patch: saves text fields after 500ms of inactivity.
  // Prevents data loss when card collapses (unmount skips onBlur).
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  function debouncedPatch(id: string, field: string, value: unknown) {
    const key = `${id}:${field}`;
    const existing = debounceTimers.current.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.current.set(key, setTimeout(() => {
      debounceTimers.current.delete(key);
      patchNode(id, field, value);
    }, 1500));
  }

  // Flush any pending debounced patches (called on unmount)
  useEffect(() => {
    return () => {
      for (const timer of debounceTimers.current.values()) clearTimeout(timer);
      debounceTimers.current.clear();
    };
  }, []);

  function handleFieldChange(nodeId: string, field: keyof Node, value: unknown) {
    updateNode(nodeId, { [field]: value } as Partial<Node>);
    debouncedPatch(nodeId, field, value);
  }

  function handleFieldBlur(nodeId: string, field: string, value: unknown) {
    // Flush any pending debounce and save immediately
    const key = `${nodeId}:${field}`;
    const existing = debounceTimers.current.get(key);
    if (existing) {
      clearTimeout(existing);
      debounceTimers.current.delete(key);
    }
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
      // Find the workstream header node — top-level node whose name matches the workstream display name
      const wsHeader = nodes.find((n) => n.name === workstream && !parentMap.has(n.id) && !n.workstream);

      // Create the new node group node
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: boardAddLabel.trim(),
          workstream,
          priority: "P1",
          status: "not_started",
        }),
      });

      // Link it under the workstream header as a child (makes it a cluster parent in the hierarchy)
      if (wsHeader) {
        // parent_of edge: workstream owns this node group
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: wsHeader.id, target_id: node.id, type: "parent_of" }),
        });
        // sequence edge: this node group feeds into its workstream
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: node.id, target_id: wsHeader.id, type: "sequence" }),
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
        // parent_of edge: cluster owns this node
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: clusterId, target_id: node.id, type: "parent_of" }),
        });
        // sequence edge: this node feeds into its node group
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: node.id, target_id: clusterId, type: "sequence" }),
        });
      }
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
            <div
              className="board-card-title"
              style={isExp ? { cursor: "text" } : undefined}
              contentEditable={isExp}
              suppressContentEditableWarning
              spellCheck={false}
              onClick={isExp ? (e) => e.stopPropagation() : undefined}
              onBlur={isExp ? (e) => handleEditableBlur(e, (newName) => renameNode(n.id, newName), n.name) : undefined}
              onKeyDown={isExp ? handleEditableKeyDown : undefined}
            >{n.name}</div>
            <div className="board-card-meta">
              <Badge variant="outline" className="font-[Tomorrow] text-[8px] tracking-[0.8px] uppercase" style={{ background: pColor + "18", color: pColor, borderColor: pColor + "30" }}>{n.priority}</Badge>
              <Badge variant="outline" className="font-[Tomorrow] text-[8px] tracking-[0.8px] uppercase" style={{ background: sColor + "18", color: sColor, borderColor: sColor + "30" }}>{statusLabel(n.status)}</Badge>
              {raciData.responsible && <span className="board-card-owner">{raciData.responsible}</span>}
            </div>
          </div>
          {isExp && (
            <div className="board-card-body" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <div className="dp-field">
                <Label className="dp-label">Notes</Label>
                <Textarea
                  className="font-[Tomorrow] text-[13px]"
                  value={n.notes ?? ""}
                  placeholder="Freeform notes, links, context..."
                  onChange={(e) => handleFieldChange(n.id, "notes", e.target.value)}
                  onBlur={(e) => handleFieldBlur(n.id, "notes", e.target.value)}
                />
              </div>
              <div className="dp-field" style={{ marginTop: 8 }}>
                <Label className="dp-label">Deliverables</Label>
                <Textarea
                  className="font-[Tomorrow] text-[13px]"
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
                <div className="dp-field" style={{ gridColumn: "1 / -1" }}>
                  <Label className="dp-label">RACI</Label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    <div><Label className="dp-label" style={{ fontSize: 7 }}>R</Label><Input className="font-[Tomorrow] text-[11px]" value={raciData.responsible}
                      onChange={(e) => {
                        const next = { ...raciData, responsible: e.target.value };
                        handleFieldChange(n.id, "raci", JSON.stringify(next));
                      }}
                      onBlur={(e) => {
                        const next = { ...raciData, responsible: e.target.value };
                        handleFieldBlur(n.id, "raci", JSON.stringify(next));
                      }}
                    /></div>
                    <div><Label className="dp-label" style={{ fontSize: 7 }}>A</Label><Input className="font-[Tomorrow] text-[11px]" value={raciData.accountable}
                      onChange={(e) => {
                        const next = { ...raciData, accountable: e.target.value };
                        handleFieldChange(n.id, "raci", JSON.stringify(next));
                      }}
                      onBlur={(e) => {
                        const next = { ...raciData, accountable: e.target.value };
                        handleFieldBlur(n.id, "raci", JSON.stringify(next));
                      }}
                    /></div>
                    <div><Label className="dp-label" style={{ fontSize: 7 }}>C</Label><Input className="font-[Tomorrow] text-[11px]" value={raciData.consulted}
                      onChange={(e) => {
                        const next = { ...raciData, consulted: e.target.value };
                        handleFieldChange(n.id, "raci", JSON.stringify(next));
                      }}
                      onBlur={(e) => {
                        const next = { ...raciData, consulted: e.target.value };
                        handleFieldBlur(n.id, "raci", JSON.stringify(next));
                      }}
                    /></div>
                    <div><Label className="dp-label" style={{ fontSize: 7 }}>I</Label><Input className="font-[Tomorrow] text-[11px]" value={raciData.informed}
                      onChange={(e) => {
                        const next = { ...raciData, informed: e.target.value };
                        handleFieldChange(n.id, "raci", JSON.stringify(next));
                      }}
                      onBlur={(e) => {
                        const next = { ...raciData, informed: e.target.value };
                        handleFieldBlur(n.id, "raci", JSON.stringify(next));
                      }}
                    /></div>
                  </div>
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
                    onChange={(e) => { updateNode(n.id, { startDate: e.target.value || null }); patchNode(n.id, "startDate", e.target.value || null); }}
                  />
                </div>
                <div className="dp-field">
                  <Label className="dp-label">End</Label>
                  <Input type="date" className="font-[Tomorrow] text-[11px]" value={n.endDate ?? ""}
                    onChange={(e) => { updateNode(n.id, { endDate: e.target.value || null }); patchNode(n.id, "endDate", e.target.value || null); }}
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
              {/* Relations — unified incoming + outgoing */}
              {(() => {
                const allRelations = [
                  ...edges.filter((e) => e.targetId === n.id && e.type !== "parent_of").map((e) => ({ ...e, direction: "incoming" as const })),
                  ...edges.filter((e) => e.sourceId === n.id && e.type !== "parent_of").map((e) => ({ ...e, direction: "outgoing" as const })),
                ];
                const connectedIds = new Set([
                  ...allRelations.map((e) => e.direction === "incoming" ? e.sourceId : e.targetId),
                  n.id,
                ]);
                const candidateNodes = nodes.filter((nd) => !connectedIds.has(nd.id));

                async function changeEdgeType(edgeId: string, newType: string) {
                  try {
                    await api(`/edges/${edgeId}`, { method: "PATCH", body: JSON.stringify({ type: newType }) });
                    const edge = edges.find((e) => e.id === edgeId);
                    if (edge) { removeEdge(edgeId); addEdge({ ...edge, type: newType }); }
                  } catch (err) { console.error("[BoardView] change edge type:", err); }
                }

                return (
                  <div style={{ marginTop: 12 }}>
                    <div className="dp-field">
                      <Label className="dp-label">Relations</Label>
                      {allRelations.map((e) => {
                        const otherNode = nodes.find((nd) => nd.id === (e.direction === "incoming" ? e.sourceId : e.targetId));
                        return (
                          <div key={e.id} className="dp-dep" style={{ fontSize: 11, padding: "8px 10px" }}>
                            <span style={{ flex: 1 }}>
                              {e.direction === "incoming"
                                ? <>{otherNode?.name ?? "?"} <span style={{ color: "#999" }}>&rarr; this</span></>
                                : <>this <span style={{ color: "#999" }}>&rarr;</span> {otherNode?.name ?? "?"}</>
                              }
                            </span>
                            <select
                              style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #E0E0E0", background: "#F8F8F8", fontFamily: "Tomorrow", marginLeft: 8 }}
                              value={e.type}
                              onChange={(ev) => changeEdgeType(e.id, ev.target.value)}
                            >
                              {edgeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <button style={{ marginLeft: 6 }} onClick={async () => {
                              try { await api(`/edges/${e.id}`, { method: "DELETE" }); removeEdge(e.id); } catch (err) { console.error("[BoardView] remove edge:", err); }
                            }}>&times;</button>
                          </div>
                        );
                      })}
                      {allRelations.length === 0 && (
                        <div style={{ fontSize: 11, color: "#BBB", marginBottom: 4 }}>No relations yet</div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <select className="dp-input" style={{ flex: 1 }} value="" onChange={async (ev) => {
                          const targetId = ev.target.value;
                          if (!targetId) return;
                          // Default to "depends_on" — user can change the type after adding
                          try {
                            const edge = await api<Edge>("/edges", {
                              method: "POST",
                              body: JSON.stringify({ source_id: targetId, target_id: n.id, type: "depends_on" }),
                            });
                            addEdge(edge);
                            const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
                            setNodes(graph.nodes);
                            setEdges(graph.edges);
                          } catch (err) { console.error("[BoardView] add relation:", err); }
                          ev.target.value = "";
                        }}>
                          <option value="">+ Add relation...</option>
                          {candidateNodes.map((nd) => <option key={nd.id} value={nd.id}>{nd.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Button variant="destructive" size="xs" className="font-[Tomorrow] text-[8px] tracking-[1px] uppercase" onClick={() => { if (!confirm(`Delete "${n.name}"? This cannot be undone.`)) return; handleDelete(n.id); setBoardExpanded(null); }}>DELETE</Button>
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
        const color = wsColor(ws);
        // Find the workstream header node (top-level, no ws field, name matches)
        const wsHeader = nodes.find((n) => n.name === ws && !parentMap.has(n.id) && !n.workstream);

        // Find cluster (node group) IDs in this workstream:
        // These are direct children of the ws header — they are node groups, not tasks
        const clusterIds = new Set<string>();
        if (wsHeader) {
          for (const childId of childrenMap.get(wsHeader.id) ?? []) {
            clusterIds.add(childId);
          }
        }
        // Also find cluster parents of leaf nodes (catches clusters not under a ws header)
        const allWsLeafs = leafNodes.filter((n) => n.workstream === ws);
        for (const n of allWsLeafs) {
          const parent = parentMap.get(n.id);
          if (parent && parent !== wsHeader?.id) clusterIds.add(parent);
        }

        const clusters = Array.from(clusterIds)
          .map((id) => nodes.find((n) => n.id === id))
          .filter(Boolean)
          .sort((a, b) => {
            const aOrder = (a as Node).sortOrder;
            const bOrder = (b as Node).sortOrder;
            if (aOrder != null && bOrder != null) return aOrder - bOrder;
            if (aOrder != null) return -1;
            if (bOrder != null) return 1;
            return 0;
          }) as Node[];

        // Task nodes in this workstream: leaf nodes that belong to a cluster (have a parent)
        // OR are ungrouped (no parent, but not a cluster themselves)
        const allGroupNodes = allWsLeafs.filter((n) => !clusterIds.has(n.id));
        const ungrouped = allGroupNodes.filter((n) => !parentMap.has(n.id));
        const ungroupedKey = ws + "/_ungrouped";

        const isWsCollapsed = collapsedWorkstreams?.has(ws) ?? false;
        return (
          <div
            key={ws}
            className="board-group"
            onDragOver={isWsCollapsed ? (e) => onWsDragOver(e, ws) : undefined}
            onDragLeave={isWsCollapsed ? onWsDragLeave : undefined}
            onDrop={isWsCollapsed ? (e) => onWsDrop(e, ws) : undefined}
          >
            <div
              className="board-group-header"
              style={{ cursor: "pointer" }}
              draggable={isWsCollapsed}
              onDragStart={isWsCollapsed ? (e) => onWsDragStart(e, ws) : undefined}
              onDragEnd={isWsCollapsed ? onWsDragEnd : undefined}
              onClick={() => { if (wsDragOccurred.current) { wsDragOccurred.current = false; return; } setCollapsedWorkstreams((prev) => { const n = new Set(prev); if (n.has(ws)) n.delete(ws); else n.add(ws); return n; }); }}
            >
              {isWsCollapsed && (
                <div style={{ fontSize: 10, color: "#CCC", cursor: "grab", width: 14, flexShrink: 0, userSelect: "none" }} className="ws-drag-handle">::</div>
              )}
              <div style={{ fontSize: 10, color: "#999", flexShrink: 0, width: 12, textAlign: "center" }}>{isWsCollapsed ? "\u25B6" : "\u25BC"}</div>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
              <div
                className="board-group-label"
                style={{ color, cursor: "text" }}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => handleEditableBlur(e, (newName) => renameWorkstream(ws, newName), ws)}
                onKeyDown={handleEditableKeyDown}
                onDoubleClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).focus(); }}
              >{ws}</div>
              <div className="board-group-count">{allGroupNodes.length} items</div>
              {wsHeader && (
                <button
                  className="btn"
                  style={{ marginLeft: "auto", fontSize: 8, padding: "2px 6px", color: "#999", opacity: 0.5 }}
                  title="Delete workstream"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete workstream '${ws}' and all its tasks? This cannot be undone.`)) return;
                    try {
                      // Delete leaf nodes under each node group first
                      for (const cluster of clusters) {
                        const clChildren = allGroupNodes.filter((n) => parentMap.get(n.id) === cluster.id);
                        for (const child of clChildren) {
                          await api(`/nodes/${child.id}`, { method: "DELETE" });
                        }
                        // Then delete the node group itself
                        await api(`/nodes/${cluster.id}`, { method: "DELETE" });
                      }
                      // Delete ungrouped leaf nodes
                      for (const child of ungrouped) {
                        await api(`/nodes/${child.id}`, { method: "DELETE" });
                      }
                      // Finally delete the workstream header node
                      await api(`/nodes/${wsHeader.id}`, { method: "DELETE" });
                      // Refetch graph to update store
                      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
                      setNodes(graph.nodes);
                      setEdges(graph.edges);
                    } catch (err) {
                      console.error("Delete workstream failed:", err);
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            {!isWsCollapsed && <div className="board-cards">
              {clusters.map((cluster) => {
                const children = allGroupNodes.filter((n) => parentMap.get(n.id) === cluster.id);
                const subKey = ws + "/" + cluster.id;
                const isSubCol = isSubCollapsed(subKey);
                const orderedIds = getBoardOrder(subKey, children.map((n) => n.id));
                const orderedChildren = orderedIds.map((id) => children.find((n) => n.id === id)).filter(Boolean) as Node[];
                const clColor = priorityColor(cluster.priority) !== "#999" ? priorityColor(cluster.priority) : color;
                return (
                  <div
                    key={cluster.id}
                    className="board-subgroup"
                    onDragOver={isSubCol ? (e) => onClusterDragOver(e, cluster.id) : undefined}
                    onDragLeave={isSubCol ? onClusterDragLeave : undefined}
                    onDrop={isSubCol ? (e) => onClusterDrop(e, cluster.id, clusters) : undefined}
                  >
                    <div
                      className="board-subgroup-header"
                      draggable={isSubCol}
                      onDragStart={isSubCol ? (e) => onClusterDragStart(e, cluster.id, ws) : undefined}
                      onDragEnd={isSubCol ? onClusterDragEnd : undefined}
                      onClick={() => toggleSub(subKey)}
                      style={{ borderLeftColor: clColor, borderLeftWidth: 3, cursor: isSubCol ? "grab" : "pointer" }}
                    >
                      <div className="board-subgroup-toggle">{isSubCol ? "\u25B6" : "\u25BC"}</div>
                      <div
                        className="board-subgroup-label"
                        style={{ color: clColor, cursor: isSubCol ? undefined : "text" }}
                        contentEditable={!isSubCol}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onClick={!isSubCol ? (e) => e.stopPropagation() : undefined}
                        onBlur={!isSubCol ? (e) => handleEditableBlur(e, (newName) => renameNode(cluster.id, newName), cluster.name) : undefined}
                        onKeyDown={!isSubCol ? handleEditableKeyDown : undefined}
                      >{cluster.name}</div>
                      <div className="board-subgroup-count">{children.length}</div>
                      <button
                        className="btn"
                        style={{ marginLeft: "auto", fontSize: 8, padding: "2px 6px", color: "#666" }}
                        title="Edit node group details"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectNode(cluster);
                        }}
                      >
                        &#9998;
                      </button>
                      <button
                        className="btn"
                        style={{ fontSize: 8, padding: "2px 6px", color: "#999", opacity: 0.5 }}
                        title="Delete node group"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete node group "${cluster.name}" and all its tasks?`)) return;
                          try {
                            // Delete all children first
                            for (const child of children) {
                              await api(`/nodes/${child.id}`, { method: "DELETE" });
                              removeNode(child.id);
                            }
                            // Then delete the cluster node itself
                            await api(`/nodes/${cluster.id}`, { method: "DELETE" });
                            removeNode(cluster.id);
                            const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
                            setNodes(graph.nodes);
                            setEdges(graph.edges);
                          } catch (err) { console.error("Delete node group failed:", err); }
                        }}
                      >
                        ✕
                      </button>
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
                  <div className="board-subgroup-header" onClick={() => toggleSub(ungroupedKey)} style={{ borderLeftColor: "#999", borderLeftWidth: 3 }}>
                    <div className="board-subgroup-toggle">{isSubCollapsed(ungroupedKey) ? "\u25B6" : "\u25BC"}</div>
                    <div className="board-subgroup-label" style={{ color: "#777" }}>Other</div>
                    <div className="board-subgroup-count">{ungrouped.length}</div>
                  </div>
                  {!isSubCollapsed(ungroupedKey) && (
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
            </div>}
          </div>
        );
      })}
    </div>
  );
}
