import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  buildClusterMaps,
  isClusterNode,
  statusColor,
  priorityColor,
} from "../constants";

interface Viewport {
  x: number;
  y: number;
  z: number;
}

interface GraphViewProps {
  onNavigateToNode?: (nodeId: string) => void;
}

function isGoalNode(node: Node): boolean {
  const name = node.name.toLowerCase();
  return name.includes("goal") || name.includes("mission");
}

function computeLayout(
  nodes: Node[],
  edges: Edge[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const goalNode = nodes.find(isGoalNode);
  if (goalNode) {
    positions.set(goalNode.id, { x: 0, y: 0 });
  }

  const workstreams = new Map<string, Node[]>();
  for (const n of nodes) {
    if (goalNode && n.id === goalNode.id) continue;
    const ws = n.workstream ?? "Other";
    const group = workstreams.get(ws) ?? [];
    group.push(n);
    workstreams.set(ws, group);
  }

  const wsEntries = [...workstreams.entries()];
  const wsCount = wsEntries.length;
  const baseRadius = Math.max(250, wsCount * 80);

  wsEntries.forEach(([ws, wsNodes], wsIndex) => {
    const angle = (wsIndex / wsCount) * Math.PI * 2 - Math.PI / 2;
    const wsCenter = {
      x: Math.cos(angle) * baseRadius,
      y: Math.sin(angle) * baseRadius,
    };

    const clusterParents = wsNodes.filter((n) => childrenMap.has(n.id) && (childrenMap.get(n.id)?.length ?? 0) > 0);
    const ungroupedLeaves = wsNodes.filter((n) => !childrenMap.has(n.id) || (childrenMap.get(n.id)?.length ?? 0) === 0)
      .filter((n) => !parentMap.has(n.id));

    const clusterSpacingX = 200;
    const clusterSpacingY = 160;
    const cols = Math.max(2, Math.ceil(Math.sqrt(clusterParents.length)));

    clusterParents.forEach((cluster, ci) => {
      const row = Math.floor(ci / cols);
      const col = ci % cols;
      const cx = wsCenter.x + (col - (cols - 1) / 2) * clusterSpacingX;
      const cy = wsCenter.y + (row - Math.floor(clusterParents.length / cols) / 2) * clusterSpacingY;
      positions.set(cluster.id, { x: cx, y: cy });

      const children = childrenMap.get(cluster.id) ?? [];
      const childRadius = Math.max(60, children.length * 18);
      const arcSpan = Math.min(Math.PI * 1.2, children.length * 0.5);
      const arcStart = angle - arcSpan / 2;

      children.forEach((childId, chi) => {
        const childAngle = children.length === 1
          ? angle
          : arcStart + (chi / (children.length - 1)) * arcSpan;
        positions.set(childId, {
          x: cx + Math.cos(childAngle) * childRadius,
          y: cy + Math.sin(childAngle) * childRadius,
        });
      });
    });

    const leafRadius = clusterParents.length > 0 ? baseRadius * 0.3 : 60;
    ungroupedLeaves.forEach((leaf, li) => {
      const leafAngle = (li / Math.max(ungroupedLeaves.length, 1)) * Math.PI * 2;
      positions.set(leaf.id, {
        x: wsCenter.x + Math.cos(leafAngle) * leafRadius,
        y: wsCenter.y + Math.sin(leafAngle) * leafRadius,
      });
    });
  });

  return positions;
}

export function GraphView({ onNavigateToNode }: GraphViewProps) {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const collapsed = useGraphStore((s) => s.collapsed);
  const toggleCollapsed = useGraphStore((s) => s.toggleCollapsed);
  const collapseAll = useGraphStore((s) => s.collapseAll);

  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, z: 0.9 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const nodesRef = useRef(storeNodes);
  nodesRef.current = storeNodes;
  const dragState = useRef<{
    id: string;
    startMX: number;
    startMY: number;
    startNX: number;
    startNY: number;
    moved: boolean;
    childStarts: Record<string, { x: number; y: number }>;
  } | null>(null);
  const hasInitCollapsed = useRef(false);
  const hasInitViewport = useRef(false);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(storeEdges), [storeEdges]);

  // Collapse all clusters by default on initial load
  useEffect(() => {
    if (hasInitCollapsed.current || childrenMap.size === 0) return;
    hasInitCollapsed.current = true;
    collapseAll([...childrenMap.keys()]);
  }, [childrenMap, collapseAll]);

  const layoutPositions = useMemo(
    () => computeLayout(storeNodes, storeEdges, childrenMap, parentMap),
    [storeNodes, storeEdges, childrenMap, parentMap],
  );

  const nodePos = useCallback(
    (n: Node): { x: number; y: number } => {
      if (n.x != null && n.y != null) return { x: n.x, y: n.y };
      return layoutPositions.get(n.id) ?? { x: 0, y: 0 };
    },
    [layoutPositions],
  );

  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of storeNodes) m.set(n.id, nodePos(n));
    return m;
  }, [storeNodes, nodePos]);

  // Center viewport on goal node once we have positions
  useEffect(() => {
    if (hasInitViewport.current) return;
    const svg = svgRef.current;
    if (!svg || storeNodes.length === 0) return;
    hasInitViewport.current = true;
    const rect = svg.getBoundingClientRect();
    const z = 0.9;
    // Center the viewport on (0,0) which is where goal node sits
    setVp({
      x: rect.width / 2,
      y: rect.height / 2,
      z,
    });
  }, [storeNodes]);

  const selId = selectedNode?.id ?? null;

  // Visible nodes (hide collapsed children)
  const hiddenNodes = useMemo(() => {
    const hidden = new Set<string>();
    for (const cid of collapsed) {
      for (const childId of childrenMap.get(cid) ?? []) hidden.add(childId);
    }
    return hidden;
  }, [collapsed, childrenMap]);

  const visibleNodes = useMemo(
    () => storeNodes.filter((n) => !hiddenNodes.has(n.id)),
    [storeNodes, hiddenNodes],
  );

  // Visible edges — reroute collapsed children to parent
  const graphEdges = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ edge: Edge; fromId: string; toId: string }> = [];
    for (const e of storeEdges) {
      if (e.type === "parent_of") continue;
      let sourceId = e.sourceId;
      let targetId = e.targetId;
      if (hiddenNodes.has(sourceId)) sourceId = parentMap.get(sourceId) ?? sourceId;
      if (hiddenNodes.has(targetId)) targetId = parentMap.get(targetId) ?? targetId;
      if (sourceId === targetId) continue;
      const key = `${sourceId}>${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ edge: e, fromId: sourceId, toId: targetId });
    }
    return result;
  }, [storeEdges, hiddenNodes, parentMap]);

  // Wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = vpRef.current;
      const nz = Math.max(0.3, Math.min(5, v.z * (e.deltaY > 0 ? 0.92 : 1.08)));
      setVp({ x: mx - (mx - v.x) * (nz / v.z), y: my - (my - v.y) * (nz / v.z), z: nz });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Node drag
  function onNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    const pos = posMap.get(nodeId);
    if (!pos) return;
    const childStarts: Record<string, { x: number; y: number }> = {};
    if (isClusterNode(nodeId, childrenMap)) {
      for (const cid of childrenMap.get(nodeId) ?? []) {
        const cp = posMap.get(cid);
        if (cp) childStarts[cid] = { ...cp };
      }
    }
    dragState.current = {
      id: nodeId,
      startMX: e.clientX,
      startMY: e.clientY,
      startNX: pos.x,
      startNY: pos.y,
      moved: false,
      childStarts,
    };

    const onMove = (me: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = me.clientX - ds.startMX;
      const dy = me.clientY - ds.startMY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.moved) {
        const v = vpRef.current;
        const mx = dx / v.z;
        const my = dy / v.z;
        const newX = ds.startNX + mx;
        const newY = ds.startNY + my;
        updateNode(ds.id, { x: newX, y: newY });
        for (const [cid, start] of Object.entries(ds.childStarts)) {
          updateNode(cid, { x: start.x + mx, y: start.y + my });
        }
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const ds = dragState.current;
      if (ds && !ds.moved) {
        const node = storeNodes.find((n) => n.id === ds.id) ?? null;
        selectNode(node);
      }
      if (ds?.moved) {
        const pos = posMap.get(ds.id);
        if (pos) {
          api(`/nodes/${ds.id}`, {
            method: "PATCH",
            body: JSON.stringify({ x: pos.x, y: pos.y, position_pinned: 1 }),
          }).catch(() => {});
        }
      }
      dragState.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Background pan
  function onBgMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let panned = false;
    const startVp = { ...vpRef.current };
    const onMove = (me: MouseEvent) => {
      if (Math.abs(me.clientX - startX) > 3 || Math.abs(me.clientY - startY) > 3) panned = true;
      setVp({ x: startVp.x + (me.clientX - startX), y: startVp.y + (me.clientY - startY), z: startVp.z });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!panned) selectNode(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Connected nodes for selection highlighting
  const goalNode = useMemo(() => storeNodes.find(isGoalNode) ?? null, [storeNodes]);

  const connectedIds = useMemo(() => {
    if (!selId) return new Set<string>();
    const ids = new Set<string>();
    ids.add(selId);
    for (const e of storeEdges) {
      if (e.sourceId === selId) ids.add(e.targetId);
      if (e.targetId === selId) ids.add(e.sourceId);
    }
    const pid = parentMap.get(selId);
    if (pid) {
      ids.add(pid);
      for (const sib of childrenMap.get(pid) ?? []) ids.add(sib);
    }
    for (const child of childrenMap.get(selId) ?? []) ids.add(child);
    if (goalNode) {
      const clusterIds = [...childrenMap.keys()];
      if (selId === goalNode.id) {
        for (const cid of clusterIds) ids.add(cid);
      } else if (clusterIds.includes(selId)) {
        ids.add(goalNode.id);
      }
    }
    return ids;
  }, [selId, storeEdges, parentMap, childrenMap, goalNode]);

  // Status indicator: small dot on node
  function statusDot(cx: number, cy: number, r: number, status: string) {
    if (status === "not_started") return null;
    const dotR = 3;
    return (
      <circle
        cx={cx + r * 0.7}
        cy={cy - r * 0.7}
        r={dotR}
        fill={statusColor(status)}
        stroke="#FFF"
        strokeWidth={1}
        pointerEvents="none"
      />
    );
  }

  return (
    <div className="canvas-area" style={{ background: "#FEFEFE" }}>
      <svg ref={svgRef} onMouseDown={onBgMouseDown} style={{ userSelect: "none", cursor: "grab" }}>
        <g style={{ transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.z})`, transformOrigin: "0 0" }}>

          {/* Subtle connector lines from cluster parents to goal node */}
          {(() => {
            const gn = visibleNodes.find(isGoalNode);
            if (!gn) return null;
            const goalPos = posMap.get(gn.id);
            if (!goalPos) return null;
            const clusters = visibleNodes.filter((n) => isClusterNode(n.id, childrenMap));
            return clusters.map((cluster) => {
              const cPos = posMap.get(cluster.id);
              if (!cPos) return null;
              const dx = cPos.x - goalPos.x;
              const dy = cPos.y - goalPos.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const goalR = 24;
              const clusterR = 10;
              const fx = goalPos.x + (dx / dist) * goalR;
              const fy = goalPos.y + (dy / dist) * goalR;
              const tx = cPos.x - (dx / dist) * clusterR;
              const ty = cPos.y - (dy / dist) * clusterR;
              const dim = selId && selId !== gn.id && selId !== cluster.id;
              return (
                <line
                  key={`goal-link-${cluster.id}`}
                  x1={fx} y1={fy} x2={tx} y2={ty}
                  stroke="#D0D0D0"
                  strokeWidth={0.8}
                  style={{ opacity: dim ? 0.08 : 0.4, transition: "opacity 0.2s" }}
                />
              );
            });
          })()}

          {/* Dependency edges — color-coded with arrowheads */}
          {graphEdges.map(({ edge, fromId, toId }, i) => {
            const sp = posMap.get(fromId);
            const tp = posMap.get(toId);
            if (!sp || !tp) return null;
            const dx = tp.x - sp.x;
            const dy = tp.y - sp.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = dx / dist;
            const ny = dy / dist;
            const r = 8;
            const x1 = sp.x + nx * r;
            const y1 = sp.y + ny * r;
            const x2 = tp.x - nx * r;
            const y2 = tp.y - ny * r;
            const isConnected = selId && (edge.sourceId === selId || edge.targetId === selId);
            const dim = selId && !isConnected;
            const edgeColor = edge.type === "blocks" || edge.type === "blocker" ? "#B81917"
              : edge.type === "depends_on" ? "#f59e0b"
              : edge.type === "sequence" ? "#3B82F6"
              : "#999";
            return (
              <g key={i} style={{ opacity: dim ? 0.08 : 0.6, transition: "opacity 0.2s" }}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={edgeColor}
                  strokeWidth={dim ? 0.8 : 1.5}
                  strokeDasharray={edge.type === "depends_on" ? "4,3" : undefined}
                />
                <polygon
                  points={`${x2},${y2} ${x2 - nx * 6 + ny * 3},${y2 - ny * 6 - nx * 3} ${x2 - nx * 6 - ny * 3},${y2 - ny * 6 + nx * 3}`}
                  fill={edgeColor}
                />
              </g>
            );
          })}

          {/* Cluster pills (collapsed) */}
          {visibleNodes.filter((n) => isClusterNode(n.id, childrenMap)).map((cluster) => {
            const childCount = (childrenMap.get(cluster.id) ?? []).length;
            const isCol = collapsed.has(cluster.id);
            const isSel = selId === cluster.id;
            const pos = posMap.get(cluster.id) ?? { x: 0, y: 0 };
            const dim = selId && !isSel && !connectedIds.has(cluster.id);

            if (isCol) {
              // Compact pill
              const label = cluster.name;
              const pillW = Math.max(60, label.length * 5.5 + 36);
              const pillH = 20;
              return (
                <g key={`cl-${cluster.id}`}
                  style={{ opacity: dim ? 0.2 : 1, transition: "opacity 0.2s" }}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, cluster.id)}
                >
                  <rect
                    x={pos.x - pillW / 2} y={pos.y - pillH / 2}
                    width={pillW} height={pillH}
                    rx={pillH / 2}
                    fill={isSel ? "#1A1A1A" : "#FFF"}
                    stroke={isSel ? "#1A1A1A" : "#D0D0D0"}
                    strokeWidth={isSel ? 1.5 : 0.8}
                  />
                  <text
                    x={pos.x - pillW / 2 + 10} y={pos.y + 3}
                    fontSize="7" fontWeight="600" letterSpacing="0.5"
                    fill={isSel ? "#FFF" : "#555"}
                    pointerEvents="none"
                  >
                    {label}
                  </text>
                  <text
                    x={pos.x + pillW / 2 - 18} y={pos.y + 3}
                    fontSize="7" fill={isSel ? "#999" : "#BBB"}
                    pointerEvents="none"
                  >
                    {childCount}
                  </text>
                  <text
                    x={pos.x + pillW / 2 - 10} y={pos.y + 3.5}
                    fontSize="7" fill={isSel ? "#999" : "#CCC"}
                    style={{ cursor: "pointer" }}
                    onMouseDown={(e) => { e.stopPropagation(); toggleCollapsed(cluster.id); }}
                  >
                    +
                  </text>
                </g>
              );
            }

            // Expanded cluster: minimal container
            const ch = visibleNodes.filter((n) => parentMap.get(n.id) === cluster.id);
            if (!ch.length) return null;
            const pad = 20;
            const chPositions = ch.map((n) => posMap.get(n.id)).filter(Boolean) as { x: number; y: number }[];
            const allPositions = [pos, ...chPositions];
            const minX = Math.min(...allPositions.map((p) => p.x)) - pad;
            const maxX = Math.max(...allPositions.map((p) => p.x)) + pad;
            const minY = Math.min(...allPositions.map((p) => p.y)) - pad;
            const maxY = Math.max(...allPositions.map((p) => p.y)) + pad;
            const rW = maxX - minX;
            const rH = maxY - minY;

            return (
              <g key={`cl-${cluster.id}`} style={{ opacity: dim ? 0.2 : 1, transition: "opacity 0.2s" }}>
                <rect
                  x={minX} y={minY} width={rW} height={rH}
                  rx={12}
                  fill="none"
                  stroke="#E8E8E8"
                  strokeWidth={0.6}
                  strokeDasharray="4,3"
                />
                {/* Cluster label — minimal */}
                <text
                  x={minX + 8} y={minY + 11}
                  fontSize="6" fontWeight="500" letterSpacing="1"
                  fill="#CCC"
                  pointerEvents="none"
                >
                  {cluster.name.toUpperCase()}
                </text>
                {/* Collapse button */}
                <text
                  x={maxX - 10} y={minY + 11}
                  fontSize="7" fill="#CCC"
                  style={{ cursor: "pointer" }}
                  onMouseDown={(e) => { e.stopPropagation(); toggleCollapsed(cluster.id); }}
                >
                  −
                </text>
              </g>
            );
          })}

          {/* Goal node — clean circle */}
          {(() => {
            const gn = visibleNodes.find(isGoalNode);
            if (!gn) return null;
            const pos = posMap.get(gn.id) ?? { x: 0, y: 0 };
            const r = 22;
            const isSelected = selId === gn.id;
            const dimmed = selId && !isSelected && !connectedIds.has(gn.id);
            return (
              <g
                className="graph-node"
                onMouseDown={(e) => onNodeMouseDown(e, gn.id)}
                style={{ opacity: dimmed ? 0.2 : 1, transition: "opacity 0.2s" }}
              >
                <circle
                  cx={pos.x} cy={pos.y} r={r}
                  fill="#1A1A1A"
                  stroke={isSelected ? "#B81917" : "none"}
                  strokeWidth={isSelected ? 2 : 0}
                />
                <text
                  x={pos.x} y={pos.y + 1}
                  textAnchor="middle"
                  fontSize="7"
                  fontWeight="600"
                  fill="#FFFFFF"
                  pointerEvents="none"
                >
                  {gn.name.length > 18 ? gn.name.slice(0, 16) + "…" : gn.name}
                </text>
                <text
                  x={pos.x} y={pos.y + r + 12}
                  textAnchor="middle"
                  fontSize="6"
                  fontWeight="400"
                  fill="#BBB"
                  letterSpacing="1.5"
                  pointerEvents="none"
                >
                  GOAL
                </text>
              </g>
            );
          })()}

          {/* Regular nodes — clean circles with labels */}
          {visibleNodes
            .filter((n) => !isClusterNode(n.id, childrenMap) && !isGoalNode(n))
            .map((node) => {
              const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
              const r = 6;
              const isSelected = selId === node.id;
              const dimmed = selId && !isSelected && !connectedIds.has(node.id);
              const fill = node.status === "done" ? "#16a34a" : priorityColor(node.priority);
              return (
                <g
                  key={node.id}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                  style={{ opacity: dimmed ? 0.15 : 1, transition: "opacity 0.2s" }}
                >
                  <circle
                    cx={pos.x} cy={pos.y}
                    r={isSelected ? r + 1.5 : r}
                    fill={fill}
                    stroke={isSelected ? "#1A1A1A" : "#FFF"}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  {statusDot(pos.x, pos.y, r, node.status)}
                  <text
                    x={pos.x} y={pos.y + r + 10}
                    textAnchor="middle"
                    fontSize="7"
                    fontWeight={isSelected ? "600" : "400"}
                    fill={isSelected ? "#1A1A1A" : "#777"}
                    pointerEvents="none"
                  >
                    {node.name.length > 24 ? node.name.slice(0, 22) + "…" : node.name}
                  </text>
                </g>
              );
            })}
        </g>
      </svg>
    </div>
  );
}
