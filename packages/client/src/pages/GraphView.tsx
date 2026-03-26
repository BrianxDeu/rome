import { useCallback, useRef, useMemo, useEffect, useState } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node } from "@rome/shared";
import {
  buildClusterMaps,
  isClusterNode,
  statusColor,
  priorityColor,
} from "../constants";
import { useStaticLayout } from "../hooks/useForceSimulation";
import { isGoalNode } from "../utils/graphLayout";

interface Viewport {
  x: number;
  y: number;
  z: number;
}

export function GraphView() {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNode = useGraphStore((s) => s.updateNode);

  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, z: 1 });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const hasInitViewport = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const { parentMap, childrenMap } = useMemo(
    () => buildClusterMaps(storeEdges),
    [storeEdges],
  );

  // Workstream header: no parent, no ws field, not goal, AND has children
  // (nodes with no parent + no ws + no children are just orphan nodes, not ws headers)
  const isWsHeader = useCallback(
    (n: Node) => !parentMap.has(n.id) && !isGoalNode(n) && !n.workstream && (childrenMap.get(n.id)?.length ?? 0) > 0,
    [parentMap, childrenMap],
  );

  // "Structural" nodes: cluster parents OR workstream headers (rendered as big nodes, not task dots)
  const isStructuralNode = useCallback(
    (n: Node) => isClusterNode(n.id, childrenMap) || isWsHeader(n),
    [childrenMap, isWsHeader],
  );

  const { positions: posMap, onDragMove } = useStaticLayout(storeNodes, storeEdges);

  const selId = selectedNode?.id ?? null;

  // Which child nodes are hidden (their cluster is collapsed)?
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const [clusterId, children] of childrenMap.entries()) {
      if (!expandedClusters.has(clusterId)) {
        for (const childId of children) hidden.add(childId);
      }
    }
    return hidden;
  }, [childrenMap, expandedClusters]);

  // Toggle cluster expand/collapse
  function toggleCluster(clusterId: string) {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }

  // Fit-to-viewport
  const fitToViewport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || posMap.size === 0) return;
    const rect = svg.getBoundingClientRect();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [id, pos] of posMap.entries()) {
      if (hiddenNodeIds.has(id)) continue;
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    if (minX === Infinity) return;
    const padding = 60;
    const graphW = maxX - minX + padding * 2;
    const graphH = maxY - minY + padding * 2;
    const z = Math.min(rect.width / graphW, rect.height / graphH, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setVp({
      x: rect.width / 2 - cx * z,
      y: rect.height / 2 - cy * z,
      z,
    });
  }, [posMap, hiddenNodeIds]);

  // Initial fit-to-viewport
  useEffect(() => {
    if (hasInitViewport.current || posMap.size === 0) return;
    hasInitViewport.current = true;
    fitToViewport();
  }, [posMap, fitToViewport]);

  // Dependency edges — reroute hidden children to their cluster parent
  const graphEdges = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ edgeId: string; type: string; fromId: string; toId: string }> = [];
    for (const e of storeEdges) {
      if (e.type === "parent_of") continue;
      let fromId = e.sourceId;
      let toId = e.targetId;
      // Reroute hidden nodes to their cluster parent
      if (hiddenNodeIds.has(fromId)) fromId = parentMap.get(fromId) ?? fromId;
      if (hiddenNodeIds.has(toId)) toId = parentMap.get(toId) ?? toId;
      if (fromId === toId) continue;
      const key = `${fromId}>${toId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ edgeId: e.id, type: e.type, fromId, toId });
    }
    return result;
  }, [storeEdges, hiddenNodeIds, parentMap]);

  // Connected nodes for selection highlighting
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
    const goalNode = storeNodes.find(isGoalNode);
    if (goalNode) {
      const clusterIds = [...childrenMap.keys()];
      if (selId === goalNode.id) {
        for (const cid of clusterIds) ids.add(cid);
      } else if (clusterIds.includes(selId)) {
        ids.add(goalNode.id);
      }
    }
    return ids;
  }, [selId, storeEdges, parentMap, childrenMap, storeNodes]);

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
      const nz = Math.max(0.2, Math.min(4, v.z * (e.deltaY > 0 ? 0.92 : 1.08)));
      setVp({
        x: mx - (mx - v.x) * (nz / v.z),
        y: my - (my - v.y) * (nz / v.z),
        z: nz,
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Node drag
  const dragState = useRef<{
    id: string;
    startMX: number;
    startMY: number;
    startNX: number;
    startNY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  function onNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    const pos = posMap.get(nodeId);
    if (!pos) return;

    dragState.current = {
      id: nodeId,
      startMX: e.clientX,
      startMY: e.clientY,
      startNX: pos.x,
      startNY: pos.y,
      lastX: pos.x,
      lastY: pos.y,
      moved: false,
    };

    const onMove = (me: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = me.clientX - ds.startMX;
      const dy = me.clientY - ds.startMY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.moved) {
        const v = vpRef.current;
        const newX = ds.startNX + dx / v.z;
        const newY = ds.startNY + dy / v.z;
        ds.lastX = newX;
        ds.lastY = newY;
        onDragMove(ds.id, newX, newY);
        updateNode(ds.id, { x: newX, y: newY });
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const ds = dragState.current;
      if (ds && !ds.moved) {
        // Click without drag: toggle cluster or select node
        const isCluster = isClusterNode(ds.id, childrenMap);
        if (isCluster) {
          toggleCluster(ds.id);
        }
        const node = storeNodes.find((n) => n.id === ds.id) ?? null;
        selectNode(node);
      }
      if (ds?.moved) {
        const { lastX, lastY } = ds;
        if (Number.isFinite(lastX) && Number.isFinite(lastY)) {
          api(`/nodes/${ds.id}`, {
            method: "PATCH",
            body: JSON.stringify({ x: Math.round(lastX * 10) / 10, y: Math.round(lastY * 10) / 10, position_pinned: true }),
          }).catch((err) => console.error("Failed to save position:", err));
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
      setVp({
        x: startVp.x + (me.clientX - startX),
        y: startVp.y + (me.clientY - startY),
        z: startVp.z,
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!panned) selectNode(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const goalNode = useMemo(() => storeNodes.find(isGoalNode) ?? null, [storeNodes]);

  function edgeColor(type: string): string {
    if (type === "blocks" || type === "blocker") return "#B81917";
    if (type === "depends_on") return "#f59e0b";
    if (type === "sequence") return "#3B82F6";
    return "#999";
  }

  function statusDot(cx: number, cy: number, r: number, status: string) {
    if (status === "not_started") return null;
    return (
      <circle cx={cx + r * 0.7} cy={cy - r * 0.7} r={3} fill={statusColor(status)} stroke="#FFF" strokeWidth={1} pointerEvents="none" />
    );
  }

  // Compute bounding box for expanded cluster's children
  function clusterBounds(clusterId: string): { cx: number; cy: number; rx: number; ry: number } | null {
    const children = childrenMap.get(clusterId) ?? [];
    const clusterPos = posMap.get(clusterId);
    if (!clusterPos || children.length === 0) return null;

    let minX = clusterPos.x, maxX = clusterPos.x, minY = clusterPos.y, maxY = clusterPos.y;
    for (const childId of children) {
      const cp = posMap.get(childId);
      if (!cp) continue;
      minX = Math.min(minX, cp.x);
      maxX = Math.max(maxX, cp.x);
      minY = Math.min(minY, cp.y);
      maxY = Math.max(maxY, cp.y);
    }
    const pad = 25;
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: (maxX - minX) / 2 + pad,
      ry: (maxY - minY) / 2 + pad,
    };
  }

  // Empty state
  if (storeNodes.length === 0) {
    return (
      <div className="canvas-area" style={{ background: "#FEFEFE", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#999", fontSize: 12, fontFamily: "Tomorrow, sans-serif" }}>
          No nodes yet. Create your first node with +NODE.
        </span>
      </div>
    );
  }

  return (
    <div className="canvas-area" style={{ background: "#FEFEFE", position: "relative" }}>
      {/* Fit button */}
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10 }}>
        <button
          onClick={fitToViewport}
          style={{
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: 0.5,
            cursor: "pointer",
            border: "1px solid #E0E0E0",
            borderRadius: 6,
            background: "#fff",
            color: "#888",
            fontWeight: 500,
            fontFamily: "Tomorrow, sans-serif",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
          title="Fit all nodes in viewport"
        >
          FIT
        </button>
      </div>

      <svg ref={svgRef} onMouseDown={onBgMouseDown} style={{ userSelect: "none", cursor: "grab", width: "100%", height: "100%" }}>
        <defs>
          <pattern id="graph-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="0.5" fill="#E8E8E8" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#graph-dots)" pointerEvents="none" />

        <g style={{ transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.z})`, transformOrigin: "0 0" }}>

          {/* Expanded cluster boundaries (dotted ellipses) */}
          {[...expandedClusters].map((clusterId) => {
            const bounds = clusterBounds(clusterId);
            if (!bounds) return null;
            const cluster = storeNodes.find((n) => n.id === clusterId);
            const dim = selId && selId !== clusterId && !connectedIds.has(clusterId);
            return (
              <g key={`boundary-${clusterId}`} style={{ opacity: dim ? 0.1 : 0.5, transition: "opacity 0.2s" }}>
                <ellipse
                  cx={bounds.cx}
                  cy={bounds.cy}
                  rx={Math.max(bounds.rx, 30)}
                  ry={Math.max(bounds.ry, 30)}
                  fill="none"
                  stroke="#C0C0C0"
                  strokeWidth={1}
                  strokeDasharray="6,4"
                  pointerEvents="none"
                />
                <text
                  x={bounds.cx}
                  y={bounds.cy - Math.max(bounds.ry, 30) - 6}
                  textAnchor="middle"
                  fontSize="6"
                  fill="#BBB"
                  letterSpacing="1.5"
                  fontWeight="500"
                  pointerEvents="none"
                >
                  {cluster?.name.toUpperCase() ?? ""}
                </text>
              </g>
            );
          })}

          {/* Goal → structural node connector lines */}
          {(() => {
            if (!goalNode) return null;
            const goalPos = posMap.get(goalNode.id);
            if (!goalPos) return null;
            return storeNodes
              .filter((n) => isStructuralNode(n) && !isGoalNode(n))
              .map((cluster) => {
                const cPos = posMap.get(cluster.id);
                if (!cPos) return null;
                const dx = cPos.x - goalPos.x;
                const dy = cPos.y - goalPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const dim = selId && selId !== goalNode.id && selId !== cluster.id;
                return (
                  <line
                    key={`goal-${cluster.id}`}
                    x1={goalPos.x + (dx / dist) * 24}
                    y1={goalPos.y + (dy / dist) * 24}
                    x2={cPos.x - (dx / dist) * 12}
                    y2={cPos.y - (dy / dist) * 12}
                    stroke="#D0D0D0"
                    strokeWidth={0.8}
                    style={{ opacity: dim ? 0.08 : 0.4, transition: "opacity 0.2s" }}
                  />
                );
              });
          })()}

          {/* Dependency edges */}
          {graphEdges.map(({ edgeId, type, fromId, toId }) => {
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
            const isConnected = selId && (fromId === selId || toId === selId);
            const dim = selId && !isConnected;
            const color = edgeColor(type);
            return (
              <g key={edgeId} style={{ opacity: dim ? 0.08 : 0.6, transition: "opacity 0.2s" }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={dim ? 0.8 : 1.5} strokeDasharray={type === "depends_on" ? "4,3" : undefined} />
                <polygon points={`${x2},${y2} ${x2 - nx * 6 + ny * 3},${y2 - ny * 6 - nx * 3} ${x2 - nx * 6 - ny * 3},${y2 - ny * 6 + nx * 3}`} fill={color} />
              </g>
            );
          })}

          {/* Structural nodes (cluster parents + workstream headers) */}
          {storeNodes
            .filter((n) => isStructuralNode(n) && !isGoalNode(n))
            .map((cluster) => {
              const pos = posMap.get(cluster.id);
              if (!pos) return null;
              const isSel = selId === cluster.id;
              const dim = selId && !isSel && !connectedIds.has(cluster.id);
              const isHovered = hoveredNode === cluster.id;
              const isExpanded = expandedClusters.has(cluster.id);
              const childCount = (childrenMap.get(cluster.id) ?? []).length;
              const isWs = isWsHeader(cluster);
              // 3-tier hierarchy: workstream (biggest) > node group > task node
              const baseR = isWs ? 18 : 12;
              const r = isExpanded ? baseR - 2 : baseR;
              return (
                <g
                  key={`cl-${cluster.id}`}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, cluster.id)}
                  onMouseEnter={() => setHoveredNode(cluster.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ opacity: dim ? 0.15 : 1, transition: "opacity 0.2s", cursor: "pointer" }}
                >
                  {/* Dotted ring around collapsed cluster to indicate it's a group */}
                  {!isExpanded && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={r + 5}
                      fill="none"
                      stroke="#C0C0C0"
                      strokeWidth={1}
                      strokeDasharray="4,3"
                      pointerEvents="none"
                    />
                  )}
                  <circle cx={pos.x} cy={pos.y} r={r} fill={priorityColor(cluster.priority)} stroke={isSel ? "#1A1A1A" : "#FFF"} strokeWidth={isSel ? 2 : 1} />
                  {/* Child count badge on collapsed clusters */}
                  {!isExpanded && childCount > 0 && (
                    <g pointerEvents="none">
                      <circle cx={pos.x + r - 2} cy={pos.y - r + 2} r={6} fill="#1A1A1A" />
                      <text x={pos.x + r - 2} y={pos.y - r + 5} textAnchor="middle" fontSize="7" fontWeight="600" fill="#FFF">
                        {childCount}
                      </text>
                    </g>
                  )}
                  {statusDot(pos.x, pos.y, r, cluster.status)}
                  <text x={pos.x} y={pos.y + r + 10} textAnchor="middle" fontSize={isHovered ? 11 : 8} fontWeight={isSel || isHovered ? "600" : "500"} fill={isSel ? "#1A1A1A" : "#777"} pointerEvents="none" style={{ transition: "font-size 0.15s" }}>
                    {cluster.name.length > 24 ? cluster.name.slice(0, 22) + "…" : cluster.name}
                  </text>
                  {!isExpanded && (
                    <text x={pos.x} y={pos.y + r + 19} textAnchor="middle" fontSize="6" fill="#BBB" pointerEvents="none">
                      click to expand
                    </text>
                  )}
                </g>
              );
            })}

          {/* Goal node */}
          {(() => {
            const gn = goalNode;
            if (!gn) return null;
            const pos = posMap.get(gn.id);
            if (!pos) return null;
            const isSelected = selId === gn.id;
            const dimmed = selId && !isSelected && !connectedIds.has(gn.id);
            return (
              <g className="graph-node" onMouseDown={(e) => onNodeMouseDown(e, gn.id)} style={{ opacity: dimmed ? 0.15 : 1, transition: "opacity 0.2s", cursor: "pointer" }}>
                <circle cx={pos.x} cy={pos.y} r={22} fill="#1A1A1A" stroke={isSelected ? "#B81917" : "none"} strokeWidth={isSelected ? 2 : 0} />
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" fontSize="7" fontWeight="600" fill="#FFFFFF" pointerEvents="none">
                  {gn.name.length > 18 ? gn.name.slice(0, 16) + "…" : gn.name}
                </text>
                <text x={pos.x} y={pos.y + 34} textAnchor="middle" fontSize="6" fontWeight="400" fill="#BBB" letterSpacing="1.5" pointerEvents="none">GOAL</text>
              </g>
            );
          })()}

          {/* Task nodes (only visible if their cluster is expanded or they have no cluster) */}
          {storeNodes
            .filter((n) => !isStructuralNode(n) && !isGoalNode(n) && !hiddenNodeIds.has(n.id))
            .map((node) => {
              const pos = posMap.get(node.id);
              if (!pos) return null;
              const r = 6;
              const isSelected = selId === node.id;
              const dimmed = selId && !isSelected && !connectedIds.has(node.id);
              const fill = node.status === "done" ? "#16a34a" : priorityColor(node.priority);
              const isHovered = hoveredNode === node.id;
              return (
                <g
                  key={node.id}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ opacity: dimmed ? 0.15 : 1, transition: "opacity 0.2s", cursor: "pointer" }}
                >
                  <circle cx={pos.x} cy={pos.y} r={isSelected ? r + 1.5 : r} fill={fill} stroke={isSelected ? "#1A1A1A" : "#FFF"} strokeWidth={isSelected ? 2 : 1} />
                  {statusDot(pos.x, pos.y, r, node.status)}
                  <text x={pos.x} y={pos.y + r + 10} textAnchor="middle" fontSize={isHovered ? 11 : 7} fontWeight={isSelected || isHovered ? "600" : "400"} fill={isSelected ? "#1A1A1A" : "#777"} pointerEvents="none" style={{ transition: "font-size 0.15s" }}>
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
