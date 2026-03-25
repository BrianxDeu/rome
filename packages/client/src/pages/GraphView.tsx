import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  buildClusterMaps,
  isClusterNode,
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

// Workstream colors
const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06B6D4", "#EC4899"];

function wsColor(ws: string, all: string[]): string {
  const idx = all.indexOf(ws);
  return WS_PALETTE[idx >= 0 ? idx % WS_PALETTE.length : 0];
}

function isGoalNode(node: Node): boolean {
  const name = node.name.toLowerCase();
  return name.includes("goal") || name.includes("mission");
}

// Known workstream center positions matching reference layout:
// HALO left, ORCREST upper-right, LAPD lower-right
const WS_CENTERS: Record<string, { x: number; y: number }> = {
  "Halo MVP": { x: -200, y: 0 },
  "Orcrest":  { x: 350, y: -150 },
  "LAPD":     { x: 300, y: 200 },
};

// Layout for nodes without x/y
function computeLayout(
  nodes: Node[],
  edges: Edge[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Goal node at center
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

  let wsAngle = 0;
  const wsCount = workstreams.size;

  for (const [wsName, wsNodes] of workstreams) {
    const known = WS_CENTERS[wsName];
    const wsCenter = known ?? (() => {
      const angleRad = (wsAngle / wsCount) * 2 * Math.PI - Math.PI / 2;
      const wsRadius = 450;
      return {
        x: Math.cos(angleRad) * wsRadius,
        y: Math.sin(angleRad) * wsRadius,
      };
    })();

    const clusterParents = wsNodes.filter((n) => isClusterNode(n.id, childrenMap));
    const leafNodes = wsNodes.filter((n) => !isClusterNode(n.id, childrenMap) && !parentMap.has(n.id));

    let yOff = 0;
    for (const cp of clusterParents) {
      const children = (childrenMap.get(cp.id) ?? [])
        .map((cid) => nodes.find((n) => n.id === cid))
        .filter(Boolean) as Node[];
      positions.set(cp.id, { x: wsCenter.x, y: wsCenter.y + yOff });
      for (let i = 0; i < children.length; i++) {
        positions.set(children[i].id, {
          x: wsCenter.x + ((i % 3) - 1) * 180,
          y: wsCenter.y + yOff + 80 + Math.floor(i / 3) * 80,
        });
      }
      yOff += 80 + Math.ceil(children.length / 3) * 80 + 60;
    }

    for (let i = 0; i < leafNodes.length; i++) {
      positions.set(leafNodes[i].id, {
        x: wsCenter.x + ((i % 3) - 1) * 180,
        y: wsCenter.y + yOff + Math.floor(i / 3) * 80,
      });
    }
    wsAngle++;
  }

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
  const [vp, setVp] = useState<Viewport>({ x: 500, y: 380, z: 0.75 });
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

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(storeEdges), [storeEdges]);

  // Collapse all clusters by default on initial load
  useEffect(() => {
    if (hasInitCollapsed.current || childrenMap.size === 0) return;
    hasInitCollapsed.current = true;
    collapseAll([...childrenMap.keys()]);
  }, [childrenMap, collapseAll]);

  const allWorkstreams = useMemo(
    () => [...new Set(storeNodes.map((n) => n.workstream).filter(Boolean) as string[])],
    [storeNodes],
  );

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
      const nz = Math.max(0.15, Math.min(4, v.z * (e.deltaY > 0 ? 0.92 : 1.08)));
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
        // Move children too
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
        // Persist position
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

  // Connected nodes for dimming
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
    // Goal node connects to all cluster parents
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

  return (
    <div className="canvas-area">
      <svg ref={svgRef} onMouseDown={onBgMouseDown} style={{ userSelect: "none", cursor: "grab" }}>
        <g style={{ transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.z})`, transformOrigin: "0 0" }}>

          {/* Rings */}
          {[200, 400, 600].map((r) => (
            <circle key={r} cx={0} cy={0} r={r} className="ring-circle" />
          ))}

          {/* Workstream group boxes (dashed) */}
          {allWorkstreams.map((ws) => {
            const gn = visibleNodes.filter((n) => n.workstream === ws && !isGoalNode(n));
            if (gn.length < 2) return null;
            const pad = 50;
            const positions = gn.map((n) => posMap.get(n.id)).filter(Boolean) as { x: number; y: number }[];
            if (positions.length < 2) return null;
            const x1 = Math.min(...positions.map((p) => p.x)) - pad;
            const x2 = Math.max(...positions.map((p) => p.x)) + pad;
            const y1 = Math.min(...positions.map((p) => p.y)) - pad - 20;
            const y2 = Math.max(...positions.map((p) => p.y)) + pad + 14;
            const color = wsColor(ws, allWorkstreams);
            return (
              <g key={ws}>
                <rect
                  x={x1} y={y1} width={x2 - x1} height={y2 - y1}
                  className="group-box"
                  style={{ stroke: color, strokeDasharray: "8,4" }}
                />
                <text x={x1 + 10} y={y1 + 16} fontSize="10" fontWeight="600" fill={color} pointerEvents="none">
                  {ws.toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* Cluster containers */}
          {visibleNodes.filter((n) => isClusterNode(n.id, childrenMap)).map((cluster) => {
            const childCount = (childrenMap.get(cluster.id) ?? []).length;
            const isCol = collapsed.has(cluster.id);
            const color = priorityColor(cluster.priority);
            const isSel = selId === cluster.id;
            const pos = posMap.get(cluster.id) ?? { x: 0, y: 0 };
            const clDim = selId && !isSel && !connectedIds.has(cluster.id);

            if (isCol) {
              const w = 150;
              const h = 22;
              return (
                <g key={`cl-${cluster.id}`} style={{ opacity: clDim ? 0.25 : 1, transition: "opacity 0.2s" }}>
                  <rect x={pos.x - w / 2} y={pos.y - h / 2} width={w} height={h} rx={4}
                    fill="#FFF" stroke={color} strokeWidth={isSel ? 2 : 1} style={{ cursor: "grab" }}
                    onMouseDown={(e) => onNodeMouseDown(e, cluster.id)} />
                  <text x={pos.x - w / 2 + 8} y={pos.y + 3} fontSize="7" fontWeight="600" letterSpacing="1" fill={color} pointerEvents="none">
                    {cluster.name.toUpperCase()}
                  </text>
                  <text x={pos.x + w / 2 - 30} y={pos.y + 3} fontSize="7" fill="#999" pointerEvents="none">{childCount}</text>
                  <text x={pos.x + w / 2 - 14} y={pos.y + 4} fontSize="10" fill={color} style={{ cursor: "pointer" }}
                    onMouseDown={(e) => { e.stopPropagation(); toggleCollapsed(cluster.id); }}>&#9654;</text>
                </g>
              );
            }

            const ch = visibleNodes.filter((n) => parentMap.get(n.id) === cluster.id);
            if (!ch.length) return null;
            const pad = 28;
            const hH = 22;
            const chPositions = ch.map((n) => posMap.get(n.id)).filter(Boolean) as { x: number; y: number }[];
            const allPositions = [pos, ...chPositions];
            const minX = Math.min(...allPositions.map((p) => p.x)) - pad;
            const maxX = Math.max(...allPositions.map((p) => p.x)) + pad;
            const minY = Math.min(...allPositions.map((p) => p.y)) - pad;
            const maxY = Math.max(...allPositions.map((p) => p.y)) + pad + 14;
            const rW = Math.max(150, maxX - minX);
            const rH = maxY - minY + hH;
            const rX = minX;
            const rY = minY - hH;
            return (
              <g key={`cl-${cluster.id}`} style={{ opacity: clDim ? 0.25 : 1, transition: "opacity 0.2s" }}>
                <rect x={rX} y={rY} width={rW} height={rH} rx={8}
                  fill={color} fillOpacity={0.03} stroke={color} strokeOpacity={isSel ? 0.4 : 0.12} strokeWidth={isSel ? 2 : 1} />
                <rect x={rX} y={rY} width={rW} height={hH} rx={8}
                  fill={color} fillOpacity={0.07} style={{ cursor: "grab" }}
                  onMouseDown={(e) => onNodeMouseDown(e, cluster.id)} />
                <rect x={rX} y={rY + hH - 8} width={rW} height={8} fill={color} fillOpacity={0.07} />
                <text x={rX + 10} y={rY + 15} fontSize="7" fontWeight="600" letterSpacing="1.5" fill={color} pointerEvents="none">
                  {cluster.name.toUpperCase()}
                </text>
                <text x={rX + rW - 14} y={rY + 15} fontSize="10" fill={color} style={{ cursor: "pointer" }}
                  onMouseDown={(e) => { e.stopPropagation(); toggleCollapsed(cluster.id); }}>&#9660;</text>
              </g>
            );
          })}

          {/* Edges */}
          {graphEdges.map(({ edge, fromId, toId }, i) => {
            const from = posMap.get(fromId);
            const to = posMap.get(toId);
            if (!from || !to) return null;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const nr = 8;
            const fx = from.x + (dx / dist) * nr;
            const fy = from.y + (dy / dist) * nr;
            const tx = to.x - (dx / dist) * nr;
            const ty = to.y - (dy / dist) * nr;
            const ux = dx / dist;
            const uy = dy / dist;
            const edgeDim = selId && edge.sourceId !== selId && edge.targetId !== selId;
            return (
              <g key={i} style={{ opacity: edgeDim ? 0.12 : 1, transition: "opacity 0.2s" }}>
                <line x1={fx} y1={fy} x2={tx} y2={ty} className="edge-line" />
                <polygon
                  points={`${tx},${ty} ${tx - 6 * ux + 3 * uy},${ty - 6 * uy - 3 * ux} ${tx - 6 * ux - 3 * uy},${ty - 6 * uy + 3 * ux}`}
                  className="edge-arrow"
                />
              </g>
            );
          })}

          {/* Connector lines from cluster parents to goal node */}
          {(() => {
            const goalNode = visibleNodes.find(isGoalNode);
            if (!goalNode) return null;
            const goalPos = posMap.get(goalNode.id);
            if (!goalPos) return null;
            const clusters = visibleNodes.filter((n) => isClusterNode(n.id, childrenMap));
            return clusters.map((cluster) => {
              const cPos = posMap.get(cluster.id);
              if (!cPos) return null;
              const dx = cPos.x - goalPos.x;
              const dy = cPos.y - goalPos.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const goalR = 36;
              const clusterR = 12;
              const fx = goalPos.x + (dx / dist) * goalR;
              const fy = goalPos.y + (dy / dist) * goalR;
              const tx = cPos.x - (dx / dist) * clusterR;
              const ty = cPos.y - (dy / dist) * clusterR;
              const clDim = selId && selId !== goalNode.id && selId !== cluster.id;
              return (
                <g key={`goal-link-${cluster.id}`} style={{ opacity: clDim ? 0.12 : 0.5, transition: "opacity 0.2s" }}>
                  <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#1A1A1A" strokeWidth={1.5} strokeDasharray="6,4" />
                </g>
              );
            });
          })()}

          {/* Goal node (large central black circle) */}
          {(() => {
            const goalNode = visibleNodes.find(isGoalNode);
            if (!goalNode) return null;
            const pos = posMap.get(goalNode.id) ?? { x: 0, y: 0 };
            const r = 34;
            const isSelected = selId === goalNode.id;
            const dimmed = selId && !isSelected && !connectedIds.has(goalNode.id);
            return (
              <g
                className="graph-node"
                onMouseDown={(e) => onNodeMouseDown(e, goalNode.id)}
                style={{ opacity: dimmed ? 0.25 : 1, transition: "opacity 0.2s" }}
              >
                <circle
                  cx={pos.x} cy={pos.y} r={isSelected ? r + 3 : r}
                  fill="#1A1A1A"
                  stroke={isSelected ? "#B81917" : "#414042"}
                  strokeWidth={isSelected ? 3 : 1.5}
                />
                <text
                  x={pos.x} y={pos.y - 4}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="#FFFFFF"
                  pointerEvents="none"
                >
                  {goalNode.name.length > 22 ? goalNode.name.slice(0, 20) + "…" : goalNode.name}
                </text>
                <text
                  x={pos.x} y={pos.y + 10}
                  textAnchor="middle"
                  fontSize="7"
                  fontWeight="400"
                  fill="#999"
                  pointerEvents="none"
                >
                  GOAL
                </text>
              </g>
            );
          })()}

          {/* Nodes (non-cluster, non-goal) */}
          {visibleNodes
            .filter((n) => !isClusterNode(n.id, childrenMap) && !isGoalNode(n))
            .map((node) => {
              const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
              const r = 7;
              const isSelected = selId === node.id;
              const dimmed = selId && !isSelected && !connectedIds.has(node.id);
              return (
                <g
                  key={node.id}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                  style={{ opacity: dimmed ? 0.25 : 1, transition: "opacity 0.2s" }}
                >
                  <circle
                    cx={pos.x} cy={pos.y} r={isSelected ? r + 2 : r}
                    fill={priorityColor(node.priority)}
                    stroke={isSelected ? "#1A1A1A" : "none"}
                    strokeWidth={isSelected ? 2.5 : 0}
                  />
                  {node.status === "done" && (
                    <circle cx={pos.x} cy={pos.y} r={r + 3} fill="none" stroke="#66BB6A" strokeWidth={1.5} strokeDasharray="3,2" />
                  )}
                  <text
                    x={pos.x} y={pos.y + r + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight={isSelected ? "700" : "400"}
                    fill={isSelected ? "#1A1A1A" : "#414042"}
                    pointerEvents="none"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
        </g>
      </svg>
    </div>
  );
}
