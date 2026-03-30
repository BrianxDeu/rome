import { useState, useEffect } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import type { Node, Edge } from "@rome/shared";

interface ArchiveState {
  nodes: Node[];
  edges: Edge[];
}

interface WorkstreamGroup {
  header: Node;
  descendants: Node[];
  nodeGroups: Map<string, Node[]>; // groupId -> leaf nodes
  ungrouped: Node[];
}

function buildWorkstreamGroups(data: ArchiveState): WorkstreamGroup[] {
  const { nodes, edges } = data;

  // Build parent->children map from parent_of edges
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();
  for (const e of edges) {
    if (e.type === "parent_of") {
      const children = childrenMap.get(e.sourceId) ?? [];
      children.push(e.targetId);
      childrenMap.set(e.sourceId, children);
      parentMap.set(e.targetId, e.sourceId);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Find workstream headers: no parent, no workstream field
  const headers = nodes.filter((n) => !parentMap.has(n.id) && !n.workstream);

  return headers.map((header) => {
    const directChildren = (childrenMap.get(header.id) ?? [])
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as Node[];

    const nodeGroups = new Map<string, Node[]>();
    const ungrouped: Node[] = [];
    const allDescendants: Node[] = [];

    for (const child of directChildren) {
      const grandchildren = (childrenMap.get(child.id) ?? [])
        .map((id) => nodeMap.get(id))
        .filter(Boolean) as Node[];

      if (grandchildren.length > 0) {
        // This is a node group
        nodeGroups.set(child.id, grandchildren);
        allDescendants.push(child, ...grandchildren);
      } else {
        // This is a leaf node directly under the header
        ungrouped.push(child);
        allDescendants.push(child);
      }
    }

    return { header, descendants: allDescendants, nodeGroups, ungrouped };
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.replace(" ", "T") + (dateStr.includes("Z") ? "" : "Z"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatBudget(budget: number | null): string {
  if (budget == null) return "—";
  return `$${budget.toLocaleString()}`;
}

export function ArchiveView() {
  const [data, setData] = useState<ArchiveState>({ nodes: [], edges: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState<Set<string>>(new Set());
  const selectNode = useGraphStore((s) => s.selectNode);

  useEffect(() => {
    fetchArchive();
  }, []);

  async function fetchArchive() {
    try {
      const result = await api<ArchiveState>("/archive");
      setData(result);
    } catch (e) {
      console.error("Failed to fetch archive:", e);
    }
  }

  function toggleExpand(headerId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(headerId)) next.delete(headerId);
      else next.add(headerId);
      return next;
    });
  }

  async function handleRestore(workstreamId: string) {
    setRestoring((prev) => new Set(prev).add(workstreamId));
    try {
      await api(`/archive/${workstreamId}/restore`, { method: "POST" });
      await fetchArchive();
      // Also refetch graph so active views update
      const graphData = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      useGraphStore.getState().setNodes(graphData.nodes);
      useGraphStore.getState().setEdges(graphData.edges);
    } catch (e) {
      console.error("Failed to restore workstream:", e);
    } finally {
      setRestoring((prev) => {
        const next = new Set(prev);
        next.delete(workstreamId);
        return next;
      });
    }
  }

  const groups = buildWorkstreamGroups(data);

  return (
    <div className="archive-view">
      <div className="archive-header">
        <div className="archive-title">ARCHIVE</div>
        <div className="archive-count">
          {groups.length === 0
            ? "No archived workstreams"
            : `${groups.length} workstream${groups.length === 1 ? "" : "s"} archived`}
        </div>
      </div>

      {groups.map((group) => {
        const isExpanded = expanded.has(group.header.id);
        const taskCount = group.descendants.length;
        const lastCompleted = group.descendants
          .map((n) => n.completedAt)
          .filter(Boolean)
          .sort()
          .pop();
        const lastCompletedBy = lastCompleted
          ? group.descendants.find((n) => n.completedAt === lastCompleted)?.completedBy
          : null;

        return (
          <div key={group.header.id} className="archive-ws-card">
            <div
              className="archive-ws-header"
              onClick={() => toggleExpand(group.header.id)}
            >
              <div className="archive-ws-info">
                <div className="archive-ws-dot" />
                <div className="archive-ws-name">{group.header.name}</div>
                <div className="archive-ws-meta">
                  {taskCount} task{taskCount === 1 ? "" : "s"} completed
                  {" · "}Archived {formatDate(group.header.archivedAt)}
                  {lastCompletedBy && <> · Last completed by {lastCompletedBy}</>}
                </div>
              </div>
              <div className="archive-ws-actions">
                <button
                  className="archive-btn-restore"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRestore(group.header.id);
                  }}
                  disabled={restoring.has(group.header.id)}
                >
                  {restoring.has(group.header.id) ? "RESTORING..." : "RESTORE"}
                </button>
                <span className={`archive-chevron ${isExpanded ? "open" : ""}`}>
                  &#9654;
                </span>
              </div>
            </div>

            {isExpanded && (
              <div className="archive-ws-body">
                <div className="archive-row archive-row-header">
                  <div>Task</div>
                  <div>Completed By</div>
                  <div>Completed At</div>
                  <div>Status</div>
                  <div style={{ textAlign: "right" }}>Budget</div>
                </div>

                {/* Node groups */}
                {Array.from(group.nodeGroups.entries()).map(([groupId, leaves]) => {
                  const groupNode = data.nodes.find((n) => n.id === groupId);
                  return (
                    <div key={groupId}>
                      <div className="archive-group-label">
                        {groupNode?.name ?? "Group"}
                      </div>
                      {leaves.map((leaf) => (
                        <div
                          key={leaf.id}
                          className="archive-row"
                          onClick={() => selectNode(leaf)}
                        >
                          <div className="archive-node-name">{leaf.name}</div>
                          <div className="archive-completed-by">{leaf.completedBy ?? "—"}</div>
                          <div className="archive-completed-at">{formatDate(leaf.completedAt)}</div>
                          <div>
                            <span className="archive-status-done">Done</span>
                          </div>
                          <div style={{ textAlign: "right" }}>{formatBudget(leaf.budget)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* Ungrouped nodes */}
                {group.ungrouped.length > 0 && group.nodeGroups.size > 0 && (
                  <div className="archive-group-label">Other</div>
                )}
                {group.ungrouped.map((leaf) => (
                  <div
                    key={leaf.id}
                    className="archive-row"
                    onClick={() => selectNode(leaf)}
                  >
                    <div className="archive-node-name">{leaf.name}</div>
                    <div className="archive-completed-by">{leaf.completedBy ?? "—"}</div>
                    <div className="archive-completed-at">{formatDate(leaf.completedAt)}</div>
                    <div>
                      <span className="archive-status-done">Done</span>
                    </div>
                    <div style={{ textAlign: "right" }}>{formatBudget(leaf.budget)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
