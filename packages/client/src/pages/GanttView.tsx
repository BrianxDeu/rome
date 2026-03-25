import { useMemo, useState, useRef, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import {
  priorityColor,
  buildClusterMaps,
  isClusterNode,
} from "../constants";
import type { Node, Edge } from "@rome/shared";
import { Button } from "../components/ui/button";

type TimeScale = "week" | "month" | "quarter" | "year";

const PPD: Record<TimeScale, number> = { week: 40, month: 12, quarter: 4, year: 1.5 };

interface GanttRow {
  type: "group" | "node";
  workstream?: string;
  node?: Node;
  color?: string;
}

// Workstream colors
const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

export function GanttView() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const [scale, setScale] = useState<TimeScale>("month");
  const ganttScrollRef = useRef<HTMLDivElement>(null);

  const { childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Workstreams sorted
  const workstreams = useMemo(() => {
    const ws = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) ws.add(n.workstream);
    }
    return Array.from(ws).sort();
  }, [nodes]);

  // Leaf nodes only
  const leafNodes = useMemo(
    () => nodes.filter((n) => !isClusterNode(n.id, childrenMap)),
    [nodes, childrenMap],
  );

  // Build gantt rows
  const ganttRows = useMemo(() => {
    const rows: GanttRow[] = [];
    workstreams.forEach((ws, i) => {
      const color = WS_PALETTE[i % WS_PALETTE.length];
      rows.push({ type: "group", workstream: ws, color });
      const wsNodes = leafNodes
        .filter((n) => n.workstream === ws && n.startDate && n.endDate)
        .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
      wsNodes.forEach((n) => rows.push({ type: "node", node: n }));
    });
    return rows;
  }, [workstreams, leafNodes]);

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
          {ganttRows.map((row, i) => {
            if (row.type === "group") {
              return (
                <div key={`g${row.workstream}`} className="gantt-sidebar-group" style={{ color: row.color }}>
                  {row.workstream}
                </div>
              );
            }
            return (
              <div key={row.node!.id} className="gantt-sidebar-item" onClick={() => handleClick(row.node!)}>
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
              {ganttRows.map((row, i) => {
                if (row.type === "group") {
                  return <div key={`gg${row.workstream}`} style={{ height: 32, borderBottom: "1px solid #E7E7E7", background: "#FAFAFA" }} />;
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
