import { useMemo, useState, useRef, useCallback, useLayoutEffect, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import {
  priorityColor,
  statusColor,
  buildClusterMaps,
  isClusterNode,
  DEPENDENCY_EDGE_TYPES,
} from "../constants";
import type { Node, Edge } from "@rome/shared";

type TimeScale = "week" | "month" | "quarter" | "year";

interface GanttViewProps {
  onNavigateToNode: (nodeId: string) => void;
}

const PPD: Record<TimeScale, number> = { week: 40, month: 12, quarter: 4, year: 1.5 };

const BAR_HEIGHT = 24;
const ROW_HEIGHT = 32;
const LEFT_PANEL_WIDTH = 220;
const ROW_PAD = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const HEADER_HEIGHT = 32;

function parseDate(d: string | null): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

interface GanttRow {
  type: "group" | "task";
  workstream: string;
  node?: Node;
  startDate?: Date | null;
  endDate?: Date | null;
}

function computeRows(nodes: Node[], edges: Edge[]): { rows: GanttRow[]; unscheduled: Node[] } {
  const { childrenMap } = buildClusterMaps(edges);

  // Filter out cluster parents and goal nodes
  const leafNodes = nodes.filter(
    (n) => !isClusterNode(n.id, childrenMap) && n.name !== "Goal",
  );

  // Group by workstream
  const wsMap = new Map<string, Node[]>();
  for (const n of leafNodes) {
    const ws = n.workstream ?? "Unassigned";
    if (!wsMap.has(ws)) wsMap.set(ws, []);
    wsMap.get(ws)!.push(n);
  }

  const rows: GanttRow[] = [];
  const unscheduled: Node[] = [];
  const sortedWorkstreams = [...wsMap.keys()].sort();

  for (const ws of sortedWorkstreams) {
    const wsNodes = wsMap.get(ws)!;
    const scheduled = wsNodes.filter((n) => n.startDate && n.endDate);
    const noDate = wsNodes.filter((n) => !n.startDate || !n.endDate);

    if (scheduled.length > 0) {
      rows.push({ type: "group", workstream: ws });
      // Sort by start date
      scheduled.sort((a, b) => {
        const ad = parseDate(a.startDate)!;
        const bd = parseDate(b.startDate)!;
        return ad.getTime() - bd.getTime();
      });
      for (const n of scheduled) {
        rows.push({
          type: "task",
          workstream: ws,
          node: n,
          startDate: parseDate(n.startDate),
          endDate: parseDate(n.endDate),
        });
      }
    }

    unscheduled.push(...noDate);
  }

  return { rows, unscheduled };
}

function computeTimeRange(rows: GanttRow[]): { minDate: Date; maxDate: Date } {
  // Default: March 2026 - January 2027
  let min = new Date("2026-03-01");
  let max = new Date("2027-01-01");

  for (const r of rows) {
    if (r.type !== "task") continue;
    if (r.startDate && r.startDate < min) min = r.startDate;
    if (r.endDate && r.endDate > max) max = r.endDate;
  }

  // Pad 7 days on each side
  min = new Date(min.getTime() - 7 * 86400000);
  max = new Date(max.getTime() + 14 * 86400000);

  return { minDate: min, maxDate: max };
}

interface HeaderCell {
  label: string;
  width: number;
}

function computeHeaders(scale: TimeScale, start: Date, end: Date, ppd: number): HeaderCell[] {
  const cells: HeaderCell[] = [];
  const gs = new Date(start);

  if (scale === "week") {
    const d = new Date(gs);
    const day = d.getDay();
    d.setDate(d.getDate() - day + 1); // start Monday
    while (d < end) {
      const endW = new Date(d);
      endW.setDate(endW.getDate() + 6);
      const label = `${d.getMonth() + 1}/${d.getDate()} - ${endW.getMonth() + 1}/${endW.getDate()}`;
      cells.push({ label, width: 7 * ppd });
      d.setDate(d.getDate() + 7);
    }
  } else if (scale === "month") {
    const d = new Date(gs.getFullYear(), gs.getMonth(), 1);
    while (d < end) {
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      cells.push({
        label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        width: days * ppd,
      });
      d.setMonth(d.getMonth() + 1);
    }
  } else if (scale === "quarter") {
    const d = new Date(gs.getFullYear(), Math.floor(gs.getMonth() / 3) * 3, 1);
    while (d < end) {
      const qMonth = Math.floor(d.getMonth() / 3) * 3;
      const qStart = new Date(d.getFullYear(), qMonth, 1);
      const qEnd = new Date(d.getFullYear(), qMonth + 3, 0);
      const days = Math.ceil((qEnd.getTime() - qStart.getTime()) / 86400000) + 1;
      const q = Math.floor(qMonth / 3) + 1;
      cells.push({ label: `Q${q} ${d.getFullYear()}`, width: days * ppd });
      d.setMonth(qMonth + 3);
    }
  } else {
    // year
    let y = gs.getFullYear();
    while (y <= end.getFullYear()) {
      const yStart = new Date(y, 0, 1);
      const yEnd = new Date(y, 11, 31);
      const days = Math.ceil((yEnd.getTime() - yStart.getTime()) / 86400000) + 1;
      cells.push({ label: `${y}`, width: days * ppd });
      y++;
    }
  }

  return cells;
}

export function GanttView({ onNavigateToNode }: GanttViewProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const [scale, setScale] = useState<TimeScale>("month");
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [barPositions, setBarPositions] = useState<Map<string, DOMRect>>(new Map());

  const { rows, unscheduled } = useMemo(() => computeRows(nodes, edges), [nodes, edges]);
  const { minDate, maxDate } = useMemo(() => computeTimeRange(rows), [rows]);

  const ppd = PPD[scale];
  const totalDays = daysBetween(minDate, maxDate);
  const chartWidth = Math.max(totalDays * ppd, 600);

  const today = new Date();
  const todayX = daysBetween(minDate, today) * ppd;

  const headers = useMemo(
    () => computeHeaders(scale, minDate, maxDate, ppd),
    [scale, minDate, maxDate, ppd],
  );

  // Grid line x positions (one per header cell)
  const gridXPositions = useMemo(() => {
    const positions: number[] = [];
    let x = 0;
    for (const h of headers) {
      positions.push(x);
      x += h.width;
    }
    return positions;
  }, [headers]);

  // Auto-scroll to today on mount and scale change
  useEffect(() => {
    if (ganttScrollRef.current) {
      setTimeout(() => {
        if (ganttScrollRef.current) {
          ganttScrollRef.current.scrollLeft = Math.max(0, todayX - 100);
        }
      }, 50);
    }
  }, [scale, todayX]);

  // Track bar DOM positions for dependency arrows
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
      positions.set(
        id,
        new DOMRect(rect.x - chartRect.x, rect.y - chartRect.y, rect.width, rect.height),
      );
    }
    setBarPositions(positions);
  }, [rows, scale, nodes, edges]);

  // Dependency edges for arrows
  const depEdges = useMemo(() => {
    const scheduledIds = new Set(
      rows.filter((r) => r.type === "task" && r.node).map((r) => r.node!.id),
    );
    return edges.filter(
      (e) =>
        DEPENDENCY_EDGE_TYPES.has(e.type) &&
        scheduledIds.has(e.sourceId) &&
        scheduledIds.has(e.targetId),
    );
  }, [edges, rows]);

  const handleBarClick = useCallback(
    (node: Node) => {
      selectNode(node);
      onNavigateToNode(node.id);
    },
    [selectNode, onNavigateToNode],
  );

  // Count task rows for chart height
  const chartHeight = rows.length * ROW_HEIGHT;

  return (
    <div style={styles.container}>
      {/* Scale toggle */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Time Scale:</span>
        {(["week", "month", "quarter", "year"] as TimeScale[]).map((s) => (
          <button
            key={s}
            style={{
              ...styles.scaleBtn,
              ...(scale === s ? styles.scaleBtnActive : {}),
            }}
            onClick={() => setScale(s)}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Gantt body */}
      <div style={styles.ganttWrapper}>
        {/* Left sidebar */}
        <div style={{ ...styles.leftPanel, height: chartHeight + HEADER_HEIGHT }}>
          <div style={styles.leftHeader}>Task</div>
          {rows.map((row, i) => {
            if (row.type === "group") {
              return (
                <div key={`g-${row.workstream}`} style={styles.wsLabel}>
                  {row.workstream}
                </div>
              );
            }
            return (
              <div
                key={row.node!.id}
                style={styles.leftRow}
                title={row.node!.name}
                onClick={() => handleBarClick(row.node!)}
              >
                <span style={styles.leftRowText}>{row.node!.name}</span>
              </div>
            );
          })}
        </div>

        {/* Chart area (scrollable) */}
        <div style={styles.chartScroll} ref={ganttScrollRef}>
          <div
            ref={chartAreaRef}
            style={{
              ...styles.chartArea,
              width: chartWidth,
              height: chartHeight + HEADER_HEIGHT,
            }}
          >
            {/* Header with time labels */}
            <div style={{ ...styles.timeHeader, width: chartWidth }}>
              {headers.map((h, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.timeLabel,
                    left: gridXPositions[i],
                    width: h.width,
                  }}
                >
                  {h.label}
                </div>
              ))}
            </div>

            {/* Grid lines + today line */}
            <svg
              style={{
                position: "absolute",
                top: HEADER_HEIGHT,
                left: 0,
                width: chartWidth,
                height: chartHeight,
                pointerEvents: "none",
              }}
            >
              {gridXPositions.map((x, i) => (
                <line
                  key={i}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={chartHeight}
                  stroke="var(--rome-border, #E7E7E7)"
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
                  stroke="#B81917"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              )}
            </svg>

            {/* Bars */}
            <div style={{ position: "relative", top: HEADER_HEIGHT }}>
              {rows.map((row, i) => {
                if (row.type === "group") {
                  // Empty row for group header
                  return (
                    <div
                      key={`gb-${row.workstream}`}
                      style={{
                        height: ROW_HEIGHT,
                        borderBottom: "1px solid var(--rome-border, #E7E7E7)",
                        background: "var(--rome-surface, #FAFAFA)",
                      }}
                    />
                  );
                }

                const node = row.node!;
                const sd = row.startDate!;
                const ed = row.endDate!;
                const x = Math.max(0, daysBetween(minDate, sd) * ppd);
                const w = Math.max(4, daysBetween(sd, ed) * ppd);
                const y = i * ROW_HEIGHT + ROW_PAD;
                const isDone = node.status === "done";
                const barColor = priorityColor(node.priority);

                return (
                  <div
                    key={node.id}
                    ref={(el) => setBarRef(node.id, el)}
                    onClick={() => handleBarClick(node)}
                    title={node.name}
                    style={{
                      position: "absolute",
                      left: x,
                      top: y,
                      width: w,
                      height: BAR_HEIGHT,
                      background: barColor,
                      borderRadius: 4,
                      cursor: "pointer",
                      opacity: isDone ? 0.5 : 0.85,
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 6,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      boxSizing: "border-box",
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
                        {node.name}
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
                top: HEADER_HEIGHT,
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
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#999" />
                </marker>
              </defs>
              {depEdges.map((e) => {
                // depends_on: source depends on target -> arrow from target to source
                // blocks/blocker: source blocks target -> arrow from source to target
                const [fromId, toId] =
                  e.type === "depends_on"
                    ? [e.targetId, e.sourceId]
                    : [e.sourceId, e.targetId];

                const fromRect = barPositions.get(fromId);
                const toRect = barPositions.get(toId);
                if (!fromRect || !toRect) return null;

                const x1 = fromRect.x + fromRect.width;
                const y1 = fromRect.y + fromRect.height / 2;
                const x2 = toRect.x;
                const y2 = toRect.y + toRect.height / 2;

                const dx = Math.abs(x2 - x1);
                const cpOffset = Math.max(dx * 0.4, 20);

                return (
                  <path
                    key={e.id}
                    d={`M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#999"
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
            {unscheduled.map((node) => (
              <div
                key={node.id}
                style={styles.unscheduledItem}
                onClick={() => handleBarClick(node)}
              >
                <span
                  style={{
                    ...styles.statusDot,
                    background: statusColor(node.status),
                  }}
                />
                <span style={styles.unscheduledName}>{node.name}</span>
                <span style={styles.unscheduledWs}>{node.workstream ?? "Unassigned"}</span>
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
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
    background: "var(--rome-surface, #FAFAFA)",
  },
  toolbarLabel: {
    fontSize: 13,
    color: "var(--rome-text-muted, #999)",
    fontWeight: 500,
  },
  scaleBtn: {
    padding: "4px 12px",
    border: "1px solid var(--rome-border, #E7E7E7)",
    borderRadius: 4,
    background: "none",
    color: "var(--rome-text-muted, #999)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  scaleBtnActive: {
    background: "var(--rome-surface-hover, #eee)",
    color: "var(--rome-text, #1A1A1A)",
    borderColor: "var(--rome-text-muted, #999)",
  },
  ganttWrapper: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  leftPanel: {
    width: LEFT_PANEL_WIDTH,
    minWidth: LEFT_PANEL_WIDTH,
    borderRight: "1px solid var(--rome-border, #E7E7E7)",
    overflowY: "auto",
    background: "var(--rome-surface, #FAFAFA)",
  },
  leftHeader: {
    height: HEADER_HEIGHT,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--rome-text-muted, #999)",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
  },
  wsLabel: {
    height: ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    fontSize: 11,
    fontWeight: 700,
    color: "#B81917",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
    background: "var(--rome-surface, #FAFAFA)",
  },
  leftRow: {
    height: ROW_HEIGHT,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    cursor: "pointer",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
  },
  leftRowText: {
    fontSize: 12,
    color: "var(--rome-text, #1A1A1A)",
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
    height: HEADER_HEIGHT,
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
    display: "flex",
  },
  timeLabel: {
    position: "absolute",
    top: 0,
    height: HEADER_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    color: "var(--rome-text-muted, #999)",
    borderRight: "1px solid var(--rome-border, #E7E7E7)",
    boxSizing: "border-box",
  },
  unscheduledSection: {
    borderTop: "1px solid var(--rome-border, #E7E7E7)",
    background: "var(--rome-surface, #FAFAFA)",
    maxHeight: 200,
    overflowY: "auto",
  },
  unscheduledHeader: {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--rome-text-muted, #999)",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
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
    color: "var(--rome-text, #1A1A1A)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  unscheduledWs: {
    color: "var(--rome-text-muted, #999)",
    fontSize: 11,
  },
};
