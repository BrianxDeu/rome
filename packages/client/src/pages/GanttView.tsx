import { useMemo, useState, useRef, useCallback, useLayoutEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import type { Node, Edge } from "@rome/shared";

type TimeScale = "week" | "month" | "quarter";

interface GanttViewProps {
  onNavigateToNode: (nodeId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  not_started: "#6b7280",
  in_progress: "#3b82f6",
  blocked: "#f59e0b",
  done: "#22c55e",
  cancelled: "#a855f7",
};

const BAR_HEIGHT = 24;
const ROW_HEIGHT = 36;
const LEFT_PANEL_WIDTH = 220;
const ROW_PAD = (ROW_HEIGHT - BAR_HEIGHT) / 2;

function parseDate(d: string | null): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (86400000));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDateLabel(d: Date, scale: TimeScale): string {
  if (scale === "week") {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  if (scale === "month") {
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear().toString().slice(2)}`;
}

function topologicalSort(nodeIds: string[], edges: Edge[]): string[] {
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  const nodeSet = new Set(nodeIds);

  for (const id of nodeIds) {
    adj.set(id, []);
    inDeg.set(id, 0);
  }

  for (const e of edges) {
    if (e.type !== "depends_on" && e.type !== "blocks") continue;
    // depends_on: source depends on target (target must finish first)
    // blocks: source blocks target (source must finish first)
    const [from, to] =
      e.type === "depends_on"
        ? [e.targetId, e.sourceId]
        : [e.sourceId, e.targetId];
    if (!nodeSet.has(from) || !nodeSet.has(to)) continue;
    adj.get(from)!.push(to);
    inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const id of nodeIds) {
    if (inDeg.get(id) === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    queue.sort(); // stable alphabetical within same level
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = inDeg.get(next)! - 1;
      inDeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  // Append any remaining (cycles) at the end
  for (const id of nodeIds) {
    if (!sorted.includes(id)) sorted.push(id);
  }

  return sorted;
}

interface RowData {
  node: Node;
  workstream: string;
  startDate: Date | null;
  endDate: Date | null;
}

function computeRows(nodes: Node[], edges: Edge[]): { scheduled: RowData[]; unscheduled: RowData[] } {
  // Group by workstream
  const wsMap = new Map<string, Node[]>();
  for (const n of nodes) {
    const ws = n.workstream ?? "unassigned";
    if (!wsMap.has(ws)) wsMap.set(ws, []);
    wsMap.get(ws)!.push(n);
  }

  const scheduled: RowData[] = [];
  const unscheduled: RowData[] = [];

  const sortedWorkstreams = [...wsMap.keys()].sort();

  for (const ws of sortedWorkstreams) {
    const wsNodes = wsMap.get(ws)!;
    const nodeIds = wsNodes.map((n) => n.id);
    const topoOrder = topologicalSort(nodeIds, edges);
    const nodeById = new Map(wsNodes.map((n) => [n.id, n]));

    // Sort by topo order, then by start_date within same topo level
    const ordered = topoOrder
      .map((id) => nodeById.get(id)!)
      .filter(Boolean);

    // Stable sort by startDate within topo groups
    ordered.sort((a, b) => {
      const ai = topoOrder.indexOf(a.id);
      const bi = topoOrder.indexOf(b.id);
      if (ai !== bi) return ai - bi;
      const aDate = parseDate(a.startDate);
      const bDate = parseDate(b.startDate);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.getTime() - bDate.getTime();
    });

    for (const n of ordered) {
      const sd = parseDate(n.startDate);
      const ed = parseDate(n.endDate);
      const row: RowData = { node: n, workstream: ws, startDate: sd, endDate: ed };
      if (sd && ed) {
        scheduled.push(row);
      } else {
        unscheduled.push(row);
      }
    }
  }

  return { scheduled, unscheduled };
}

function computeTimeRange(rows: RowData[]): { minDate: Date; maxDate: Date } {
  const now = new Date();
  let min = now;
  let max = now;

  for (const r of rows) {
    if (r.startDate && r.startDate < min) min = r.startDate;
    if (r.endDate && r.endDate > max) max = r.endDate;
  }

  // Add padding
  min = addDays(min, -7);
  max = addDays(max, 14);

  return { minDate: min, maxDate: max };
}

function scaleStepDays(scale: TimeScale): number {
  if (scale === "week") return 7;
  if (scale === "month") return 30;
  return 91;
}

function pixelsPerDay(scale: TimeScale): number {
  if (scale === "week") return 18;
  if (scale === "month") return 6;
  return 2;
}

export function GanttView({ onNavigateToNode }: GanttViewProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const [scale, setScale] = useState<TimeScale>("month");
  const chartRef = useRef<HTMLDivElement>(null);
  const [barPositions, setBarPositions] = useState<Map<string, DOMRect>>(new Map());
  const chartAreaRef = useRef<HTMLDivElement>(null);

  const { scheduled, unscheduled } = useMemo(() => computeRows(nodes, edges), [nodes, edges]);

  const { minDate, maxDate } = useMemo(() => computeTimeRange(scheduled), [scheduled]);

  const ppd = pixelsPerDay(scale);
  const totalDays = daysBetween(minDate, maxDate);
  const chartWidth = Math.max(totalDays * ppd, 600);

  const today = new Date();
  const todayX = daysBetween(minDate, today) * ppd;

  // Generate time grid labels
  const gridLines = useMemo(() => {
    const lines: { x: number; label: string }[] = [];
    const step = scaleStepDays(scale);
    let cursor = new Date(minDate);
    // Align to start of period
    if (scale === "month") {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    } else if (scale === "quarter") {
      const q = Math.floor(cursor.getMonth() / 3) * 3;
      cursor = new Date(cursor.getFullYear(), q, 1);
    } else {
      // week: align to Monday
      const day = cursor.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      cursor = addDays(cursor, diff);
    }

    while (cursor <= maxDate) {
      const x = daysBetween(minDate, cursor) * ppd;
      lines.push({ x, label: formatDateLabel(cursor, scale) });
      if (scale === "month") {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      } else if (scale === "quarter") {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 3, 1);
      } else {
        cursor = addDays(cursor, step);
      }
    }
    return lines;
  }, [minDate, maxDate, scale, ppd]);

  // Track bar positions for dependency arrows
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setBarRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) barRefs.current.set(id, el);
    else barRefs.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    if (!chartAreaRef.current) return;
    const chartRect = chartAreaRef.current.getBoundingClientRect();
    const positions = new Map<string, DOMRect>();
    for (const [id, el] of barRefs.current) {
      const rect = el.getBoundingClientRect();
      // Make relative to chart area
      positions.set(id, new DOMRect(
        rect.x - chartRect.x,
        rect.y - chartRect.y,
        rect.width,
        rect.height,
      ));
    }
    setBarPositions(positions);
  }, [scheduled, scale, nodes, edges]);

  // Dependency edges for arrows (depends_on and blocks)
  const depEdges = useMemo(() => {
    const scheduledIds = new Set(scheduled.map((r) => r.node.id));
    return edges.filter(
      (e) =>
        (e.type === "depends_on" || e.type === "blocks") &&
        scheduledIds.has(e.sourceId) &&
        scheduledIds.has(e.targetId),
    );
  }, [edges, scheduled]);

  const handleBarClick = useCallback(
    (node: Node) => {
      selectNode(node);
      onNavigateToNode(node.id);
    },
    [selectNode, onNavigateToNode],
  );

  const isOverdue = (row: RowData): boolean => {
    if (!row.endDate) return false;
    return row.node.status !== "done" && row.endDate < today;
  };

  const chartHeight = scheduled.length * ROW_HEIGHT;

  return (
    <div style={styles.container}>
      {/* Scale toggle */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Time Scale:</span>
        {(["week", "month", "quarter"] as TimeScale[]).map((s) => (
          <button
            key={s}
            style={{
              ...styles.scaleBtn,
              ...(scale === s ? styles.scaleBtnActive : {}),
            }}
            onClick={() => setScale(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Scheduled section */}
      <div style={styles.ganttWrapper} ref={chartRef}>
        {/* Left panel (labels) */}
        <div style={{ ...styles.leftPanel, height: chartHeight + 40 }}>
          {/* Header */}
          <div style={styles.leftHeader}>Task</div>
          {scheduled.map((row, i) => {
            const showWsLabel =
              i === 0 || scheduled[i - 1].workstream !== row.workstream;
            return (
              <div key={row.node.id}>
                {showWsLabel && (
                  <div style={styles.wsLabel}>{row.workstream}</div>
                )}
                <div
                  style={{
                    ...styles.leftRow,
                    height: ROW_HEIGHT,
                  }}
                  title={row.node.name}
                  onClick={() => handleBarClick(row.node)}
                >
                  <span style={styles.leftRowText}>{row.node.name}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Chart area */}
        <div style={styles.chartScroll}>
          <div
            ref={chartAreaRef}
            style={{
              ...styles.chartArea,
              width: chartWidth,
              height: chartHeight + 40,
            }}
          >
            {/* Header with time labels */}
            <div style={{ ...styles.timeHeader, width: chartWidth }}>
              {gridLines.map((g, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.timeLabel,
                    left: g.x,
                  }}
                >
                  {g.label}
                </div>
              ))}
            </div>

            {/* Grid lines */}
            <svg
              style={{
                position: "absolute",
                top: 32,
                left: 0,
                width: chartWidth,
                height: chartHeight,
                pointerEvents: "none",
              }}
            >
              {gridLines.map((g, i) => (
                <line
                  key={i}
                  x1={g.x}
                  y1={0}
                  x2={g.x}
                  y2={chartHeight}
                  stroke="var(--rome-border)"
                  strokeWidth={1}
                  opacity={0.5}
                />
              ))}

              {/* Today line */}
              {todayX >= 0 && todayX <= chartWidth && (
                <line
                  x1={todayX}
                  y1={0}
                  x2={todayX}
                  y2={chartHeight}
                  stroke="var(--rome-red)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              )}
            </svg>

            {/* Bars */}
            <div style={{ position: "relative", top: 32 }}>
              {scheduled.map((row, i) => {
                const x = daysBetween(minDate, row.startDate!) * ppd;
                const w = Math.max(daysBetween(row.startDate!, row.endDate!) * ppd, 8);
                const y = i * ROW_HEIGHT + ROW_PAD;
                const overdue = isOverdue(row);
                const barColor = overdue
                  ? "#ef4444"
                  : STATUS_COLORS[row.node.status] ?? "#6b7280";

                return (
                  <div
                    key={row.node.id}
                    ref={(el) => setBarRef(row.node.id, el)}
                    onClick={() => handleBarClick(row.node)}
                    title={`${row.node.name}${overdue ? " (overdue)" : ""}`}
                    style={{
                      position: "absolute",
                      left: x,
                      top: y,
                      width: w,
                      height: BAR_HEIGHT,
                      background: barColor,
                      borderRadius: 4,
                      cursor: "pointer",
                      opacity: row.node.status === "done" ? 0.6 : 1,
                      border: overdue ? "2px solid #dc2626" : "none",
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 6,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {w > 60 && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#fff",
                          fontWeight: 500,
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        {row.node.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Dependency arrows */}
            <svg
              style={{
                position: "absolute",
                top: 32,
                left: 0,
                width: chartWidth,
                height: chartHeight,
                pointerEvents: "none",
              }}
            >
              <defs>
                <marker
                  id="gantt-arrow"
                  viewBox="0 0 10 10"
                  refX={8}
                  refY={5}
                  markerWidth={6}
                  markerHeight={6}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--rome-text-muted)" />
                </marker>
              </defs>
              {depEdges.map((e) => {
                // depends_on: sourceId depends on targetId -> arrow from target to source
                // blocks: sourceId blocks targetId -> arrow from source to target
                const [fromId, toId] =
                  e.type === "depends_on"
                    ? [e.targetId, e.sourceId]
                    : [e.sourceId, e.targetId];

                const fromRect = barPositions.get(fromId);
                const toRect = barPositions.get(toId);
                if (!fromRect || !toRect) return null;

                // Arrow from end of "from" bar to start of "to" bar
                const x1 = fromRect.x + fromRect.width;
                const y1 = fromRect.y + fromRect.height / 2;
                const x2 = toRect.x;
                const y2 = toRect.y + toRect.height / 2;

                // Bezier control points
                const dx = Math.abs(x2 - x1);
                const cpOffset = Math.max(dx * 0.4, 20);

                return (
                  <path
                    key={e.id}
                    d={`M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--rome-text-muted)"
                    strokeWidth={1.5}
                    opacity={0.6}
                    markerEnd="url(#gantt-arrow)"
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* Unscheduled section */}
      {unscheduled.length > 0 && (
        <div style={styles.unscheduledSection}>
          <div style={styles.unscheduledHeader}>
            Unscheduled ({unscheduled.length})
          </div>
          <div style={styles.unscheduledList}>
            {unscheduled.map((row) => (
              <div
                key={row.node.id}
                style={styles.unscheduledItem}
                onClick={() => handleBarClick(row.node)}
              >
                <span
                  style={{
                    ...styles.statusDot,
                    background: STATUS_COLORS[row.node.status] ?? "#6b7280",
                  }}
                />
                <span style={styles.unscheduledName}>{row.node.name}</span>
                <span style={styles.unscheduledWs}>{row.workstream}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderBottom: "1px solid var(--rome-border)",
    background: "var(--rome-surface)",
  },
  toolbarLabel: {
    fontSize: 13,
    color: "var(--rome-text-muted)",
    fontWeight: 500,
  },
  scaleBtn: {
    padding: "4px 12px",
    border: "1px solid var(--rome-border)",
    borderRadius: 4,
    background: "none",
    color: "var(--rome-text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  scaleBtnActive: {
    background: "var(--rome-surface-hover)",
    color: "var(--rome-text)",
    borderColor: "var(--rome-text-muted)",
  },
  ganttWrapper: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  leftPanel: {
    width: LEFT_PANEL_WIDTH,
    minWidth: LEFT_PANEL_WIDTH,
    borderRight: "1px solid var(--rome-border)",
    overflowY: "auto",
    background: "var(--rome-surface)",
  },
  leftHeader: {
    height: 32,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--rome-text-muted)",
    borderBottom: "1px solid var(--rome-border)",
  },
  wsLabel: {
    padding: "4px 12px 2px",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--rome-red)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  leftRow: {
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    cursor: "pointer",
    borderBottom: "1px solid var(--rome-border)",
  },
  leftRowText: {
    fontSize: 12,
    color: "var(--rome-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chartScroll: {
    flex: 1,
    overflowX: "auto",
    overflowY: "auto",
  },
  chartArea: {
    position: "relative",
    minHeight: "100%",
  },
  timeHeader: {
    position: "relative",
    height: 32,
    borderBottom: "1px solid var(--rome-border)",
  },
  timeLabel: {
    position: "absolute",
    top: 0,
    height: 32,
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    color: "var(--rome-text-muted)",
    paddingLeft: 4,
    whiteSpace: "nowrap",
  },
  unscheduledSection: {
    borderTop: "1px solid var(--rome-border)",
    background: "var(--rome-surface)",
    maxHeight: 200,
    overflowY: "auto",
  },
  unscheduledHeader: {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--rome-text-muted)",
    borderBottom: "1px solid var(--rome-border)",
  },
  unscheduledList: {
    padding: "4px 0",
  },
  unscheduledItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 13,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  unscheduledName: {
    color: "var(--rome-text)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  unscheduledWs: {
    color: "var(--rome-text-muted)",
    fontSize: 11,
  },
};
