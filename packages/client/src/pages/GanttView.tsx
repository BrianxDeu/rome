import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useGraphStore } from "../stores/graphStore";
import {
  priorityColor,
  buildClusterMaps,
  isClusterNode,
} from "../constants";
import { isGoalNode } from "../utils/graphLayout";
import type { Node, Edge } from "@rome/shared";
import { Button } from "../components/ui/button";

type TimeScale = "week" | "month" | "quarter" | "year";

const PPD: Record<TimeScale, number> = { week: 40, month: 12, quarter: 4, year: 1.5 };

interface GanttRow {
  type: "workstream" | "nodegroup" | "node";
  workstream?: string;
  node?: Node;
  color?: string;
  indent?: number;
}

// Workstream colors — hash-based to match Board view
const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

function wsColor(ws: string): string {
  let hash = 0;
  for (let i = 0; i < ws.length; i++) {
    hash = ((hash << 5) - hash + ws.charCodeAt(i)) | 0;
  }
  return WS_PALETTE[((hash % WS_PALETTE.length) + WS_PALETTE.length) % WS_PALETTE.length];
}

export function GanttView() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const [scale, setScale] = useState<TimeScale>("month");
  const [collapsedWs, setCollapsedWs] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const wsInitRef = useRef(false);
  const groupInitRef = useRef(false);
  const ganttScrollRef = useRef<HTMLDivElement>(null);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Workstream field values (used to identify ws headers)
  const wsFieldValues = useMemo(() => {
    const vals = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) vals.add(n.workstream);
    }
    return vals;
  }, [nodes]);

  // Identify ws headers (same logic as BoardView)
  const isWsHeader = useCallback(
    (n: Node) => {
      if (parentMap.has(n.id) || isGoalNode(n) || n.workstream) return false;
      if ((childrenMap.get(n.id)?.length ?? 0) > 0) return true;
      if (wsFieldValues.has(n.name)) return true;
      return false;
    },
    [parentMap, childrenMap, wsFieldValues],
  );

  // Map ws name -> sort_order from header nodes (same as BoardView)
  const wsHeaderMap = useMemo(() => {
    const map = new Map<string, { sortOrder: number | null; headerId: string }>();
    for (const n of nodes) {
      if (!parentMap.has(n.id) && !isGoalNode(n) && n.name && !n.workstream) {
        map.set(n.name, { sortOrder: n.sortOrder, headerId: n.id });
      }
    }
    return map;
  }, [nodes, parentMap]);

  // Workstreams sorted by sort_order (matching Board view)
  const workstreams = useMemo(() => {
    return Array.from(wsFieldValues).sort((a, b) => {
      const aOrder = wsHeaderMap.get(a)?.sortOrder;
      const bOrder = wsHeaderMap.get(b)?.sortOrder;
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.localeCompare(b);
    });
  }, [wsFieldValues, wsHeaderMap]);

  // Node group IDs: direct children of ws headers
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

  // Map ws header name → node groups under it
  const nodeById = useMemo(() => {
    const map = new Map<string, Node>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // Collapse all workstreams by default
  useEffect(() => {
    if (!wsInitRef.current && workstreams.length > 0) {
      setCollapsedWs(new Set(workstreams));
      wsInitRef.current = true;
    }
  }, [workstreams]);

  // Collapse all node groups by default
  useEffect(() => {
    if (!groupInitRef.current && nodeGroupIds.size > 0) {
      setCollapsedGroups(new Set(nodeGroupIds));
      groupInitRef.current = true;
    }
  }, [nodeGroupIds]);

  function toggleWs(ws: string) {
    setCollapsedWs((prev) => {
      const next = new Set(prev);
      if (next.has(ws)) next.delete(ws);
      else next.add(ws);
      return next;
    });
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Build hierarchical gantt rows: workstream → node groups → leaf nodes
  const ganttRows = useMemo(() => {
    const rows: GanttRow[] = [];
    workstreams.forEach((ws, i) => {
      const color = wsColor(ws);
      rows.push({ type: "workstream", workstream: ws, color });

      if (collapsedWs.has(ws)) return;

      // Find the ws header node
      const wsHeader = nodes.find((n) => isWsHeader(n) && n.name === ws);
      const wsNodeGroupIds = wsHeader ? (childrenMap.get(wsHeader.id) ?? []) : [];

      // Get node groups for this workstream
      const nodeGroups = wsNodeGroupIds
        .map((id) => nodeById.get(id))
        .filter((n): n is Node => !!n)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (nodeGroups.length > 0) {
        // Has node groups: show hierarchy
        for (const ng of nodeGroups) {
          rows.push({ type: "nodegroup", node: ng, color, indent: 1 });

          if (!collapsedGroups.has(ng.id)) {
            // Show leaf children of this node group
            const leafChildren = (childrenMap.get(ng.id) ?? [])
              .map((id) => nodeById.get(id))
              .filter((n): n is Node => !!n)
              .sort((a, b) => {
                // Sort by start date if available, else by name
                if (a.startDate && b.startDate) return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
                return a.name.localeCompare(b.name);
              });
            for (const child of leafChildren) {
              rows.push({ type: "node", node: child, indent: 2 });
            }
          }
        }

        // Also show any leaf nodes directly in this workstream that aren't children of a node group
        const orphanLeaves = nodes.filter((n) => {
          if (n.workstream !== ws) return false;
          if (isWsHeader(n) || nodeGroupIds.has(n.id)) return false;
          if (isClusterNode(n.id, childrenMap)) return false;
          // Not a child of any node group in this workstream
          const parent = parentMap.get(n.id);
          if (parent && nodeGroupIds.has(parent)) return false;
          return true;
        });
        for (const leaf of orphanLeaves) {
          rows.push({ type: "node", node: leaf, indent: 1 });
        }
      } else {
        // No node groups: show flat leaf nodes under workstream
        const wsLeaves = nodes
          .filter((n) => n.workstream === ws && !isWsHeader(n) && !nodeGroupIds.has(n.id) && !isClusterNode(n.id, childrenMap))
          .sort((a, b) => {
            if (a.startDate && b.startDate) return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
            return a.name.localeCompare(b.name);
          });
        for (const leaf of wsLeaves) {
          rows.push({ type: "node", node: leaf, indent: 1 });
        }
      }
    });
    return rows;
  }, [workstreams, nodes, collapsedWs, collapsedGroups, isWsHeader, childrenMap, nodeById, nodeGroupIds, parentMap]);

  const hasAnyBars = ganttRows.some((r) => r.node?.startDate && r.node?.endDate);

  // Time range
  const ganttStart = new Date("2026-03-01");
  const ganttEnd = new Date("2027-01-01");
  const ppd = PPD[scale];
  const totalDays = Math.ceil((ganttEnd.getTime() - ganttStart.getTime()) / 864e5);
  const canvasW = totalDays * ppd;
  const today = new Date();
  const todayX = Math.ceil((today.getTime() - ganttStart.getTime()) / 864e5) * ppd;

  // Headers
  const headers = useMemo(() => {
    const cells: { label: string; width: number }[] = [];
    const gs = new Date(ganttStart);

    if (scale === "week") {
      const d = new Date(gs);
      d.setDate(d.getDate() - d.getDay() + 1);
      while (d < ganttEnd) {
        const end = new Date(d);
        end.setDate(end.getDate() + 6);
        cells.push({ label: `${d.getMonth() + 1}/${d.getDate()} \u2013 ${end.getMonth() + 1}/${end.getDate()}`, width: 7 * ppd });
        d.setDate(d.getDate() + 7);
      }
    } else if (scale === "month") {
      const d = new Date(gs);
      while (d < ganttEnd) {
        const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        cells.push({ label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), width: days * ppd });
        d.setMonth(d.getMonth() + 1);
      }
    } else if (scale === "quarter") {
      const d = new Date(gs);
      while (d < ganttEnd) {
        const qMonth = Math.floor(d.getMonth() / 3) * 3;
        const qStart = new Date(d.getFullYear(), qMonth, 1);
        const qEnd = new Date(d.getFullYear(), qMonth + 3, 0);
        const days = Math.ceil((qEnd.getTime() - qStart.getTime()) / 864e5) + 1;
        const q = Math.floor(qMonth / 3) + 1;
        cells.push({ label: `Q${q} ${d.getFullYear()}`, width: days * ppd });
        d.setMonth(qMonth + 3);
      }
    } else {
      let y = gs.getFullYear();
      while (y <= ganttEnd.getFullYear()) {
        const yStart = new Date(y, 0, 1);
        const yEnd = new Date(y, 11, 31);
        const days = Math.ceil((yEnd.getTime() - yStart.getTime()) / 864e5) + 1;
        cells.push({ label: `${y}`, width: days * ppd });
        y++;
      }
    }
    return cells;
  }, [scale, ppd]);

  // Auto-scroll to today
  useEffect(() => {
    if (ganttScrollRef.current) {
      setTimeout(() => {
        if (ganttScrollRef.current) {
          ganttScrollRef.current.scrollLeft = Math.max(0, todayX - 80);
        }
      }, 50);
    }
  }, [scale, todayX]);

  function handleClick(node: Node) {
    selectNode(node);
  }

  return (
    <div className="gantt-wrap">
      <div className="gantt-controls">
        {(["week", "month", "quarter", "year"] as TimeScale[]).map((s) => (
          <Button key={s} variant={scale === s ? "default" : "outline"} size="sm" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={() => setScale(s)}>
            {s.toUpperCase()}
          </Button>
        ))}
      </div>
      <div className="gantt-body">
        <div className="gantt-sidebar">
          {/* Spacer to align with canvas header */}
          <div style={{ height: 28, borderBottom: "1px solid #E7E7E7" }} />
          {ganttRows.map((row) => {
            if (row.type === "workstream") {
              const isCol = collapsedWs.has(row.workstream!);
              return (
                <div key={`ws-${row.workstream}`} className="gantt-sidebar-group" style={{ color: row.color, cursor: "pointer", userSelect: "none" }} onClick={() => toggleWs(row.workstream!)}>
                  <span style={{ display: "inline-block", width: 14, fontSize: 10, transition: "transform 0.15s", transform: isCol ? "rotate(-90deg)" : "rotate(0deg)" }}>&#9660;</span>
                  {row.workstream}
                </div>
              );
            }
            if (row.type === "nodegroup") {
              const isCol = collapsedGroups.has(row.node!.id);
              return (
                <div key={`ng-${row.node!.id}`} className="gantt-sidebar-item" style={{ paddingLeft: 20, fontWeight: 600, cursor: "pointer", userSelect: "none", fontSize: 11 }} onClick={() => toggleGroup(row.node!.id)}>
                  <span style={{ display: "inline-block", width: 12, fontSize: 8, marginRight: 4, transition: "transform 0.15s", transform: isCol ? "rotate(-90deg)" : "rotate(0deg)" }}>&#9660;</span>
                  {row.node!.name}
                </div>
              );
            }
            return (
              <div key={row.node!.id} className="gantt-sidebar-item" style={{ paddingLeft: (row.indent ?? 1) * 16 + 12 }} onClick={() => handleClick(row.node!)}>
                {row.node!.name}
              </div>
            );
          })}
        </div>
        <div className="gantt-canvas-wrap" ref={ganttScrollRef}>
          <div style={{ width: canvasW, minHeight: "100%", position: "relative" }}>
            <div className="gantt-header">
              {headers.map((m, i) => (
                <div key={i} className="gantt-header-cell" style={{ width: m.width }}>{m.label}</div>
              ))}
            </div>
            <div className="gantt-rows">
              {ganttRows.map((row) => {
                if (row.type === "workstream") {
                  return <div key={`gg-${row.workstream}`} style={{ height: 32, borderBottom: "1px solid #E7E7E7", background: "#FAFAFA" }} />;
                }
                if (row.type === "nodegroup") {
                  const n = row.node!;
                  if (!n.startDate || !n.endDate) return <div key={`ngr-${n.id}`} className="gantt-row" />;
                  const sd = new Date(n.startDate);
                  const ed = new Date(n.endDate);
                  const left = Math.max(0, Math.ceil((sd.getTime() - ganttStart.getTime()) / 864e5) * ppd);
                  const w = Math.max(4, Math.ceil((ed.getTime() - sd.getTime()) / 864e5) * ppd);
                  return (
                    <div key={`ngr-${n.id}`} className="gantt-row">
                      <div
                        className="gantt-bar"
                        style={{ left, width: w, background: row.color ?? priorityColor(n.priority), opacity: 0.7 }}
                        onClick={() => handleClick(n)}
                      >
                        {w > 60 ? n.name : ""}
                      </div>
                    </div>
                  );
                }
                const n = row.node!;
                if (!n.startDate || !n.endDate) return <div key={n.id} className="gantt-row" />;
                const sd = new Date(n.startDate);
                const ed = new Date(n.endDate);
                const left = Math.max(0, Math.ceil((sd.getTime() - ganttStart.getTime()) / 864e5) * ppd);
                const w = Math.max(4, Math.ceil((ed.getTime() - sd.getTime()) / 864e5) * ppd);
                return (
                  <div key={n.id} className="gantt-row">
                    <div
                      className="gantt-bar"
                      style={{ left, width: w, background: priorityColor(n.priority), opacity: n.status === "done" ? 0.5 : 0.85 }}
                      onClick={() => handleClick(n)}
                    >
                      {w > 60 ? n.name : ""}
                    </div>
                  </div>
                );
              })}
              <div className="gantt-today" style={{ left: todayX }} />
              {!hasAnyBars && (
                <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", color: "#999", fontSize: 12, letterSpacing: 0.5, pointerEvents: "none" }}>
                  Set start and end dates on nodes to see timeline bars here.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
