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
import {
  useForceSimulation,
  type LayoutMode,
} from "../hooks/useForceSimulation";
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

  const { parentMap, childrenMap } = useMemo(
    () => buildClusterMaps(storeEdges),
    [storeEdges],
  );

  const {
    positions: posMap,
    mode,
    setMode,
    onDragStart: simDragStart,
    onDragEnd: simDragEnd,
    settled,
  } = useForceSimulation(storeNodes, storeEdges);

  const selId = selectedNode?.id ?? null;

  // Fit-to-viewport: compute bounds of all nodes and set zoom/pan to fit
  const fitToViewport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || posMap.size === 0) return;
    const rect = svg.getBoundingClientRect();

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const pos of posMap.values()) {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    const padding = 60;
    const graphW = maxX - minX + padding * 2;
    const graphH = maxY - minY + padding * 2;
    const z = Math.min(
      rect.width / graphW,
      rect.height / graphH,
      2,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setVp({
      x: rect.width / 2 - cx * z,
      y: rect.height / 2 - cy * z,
      z,
    });
  }, [posMap]);

  // Initial fit-to-viewport once positions are available
  useEffect(() => {
    if (hasInitViewport.current || posMap.size === 0 || !settled) return;
    hasInitViewport.current = true;
    fitToViewport();
  }, [posMap, settled, fitToViewport]);

  // Visible edges — skip parent_of, reroute collapsed children to parent
  const graphEdges = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{
      edgeId: string;
      type: string;
      fromId: string;
      toId: string;
    }> = [];
    for (const e of storeEdges) {
      if (e.type === "parent_of") continue;
      const sourceId = e.sourceId;
      const targetId = e.targetId;
      if (sourceId === targetId) continue;
      const key = `${sourceId}>${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        edgeId: e.id,
        type: e.type,
        fromId: sourceId,
        toId: targetId,
      });
    }
    return result;
  }, [storeEdges]);

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
    // If goal is selected, show all cluster parents; if cluster selected, show goal
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

  // Drag state for nodes
  const dragState = useRef<{
    id: string;
    startMX: number;
    startMY: number;
    startNX: number;
    startNY: number;
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
      moved: false,
    };

    simDragStart(nodeId, e.clientX, e.clientY);

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
        updateNode(ds.id, { x: newX, y: newY });
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
      const shouldPatch = simDragEnd();
      if (shouldPatch && ds?.moved) {
        const pos = posMap.get(ds.id);
        if (
          pos &&
          Number.isFinite(pos.x) &&
          Number.isFinite(pos.y)
        ) {
          api(`/nodes/${ds.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              x: pos.x,
              y: pos.y,
              position_pinned: 1,
            }),
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
      if (Math.abs(me.clientX - startX) > 3 || Math.abs(me.clientY - startY) > 3)
        panned = true;
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

  const goalNode = useMemo(
    () => storeNodes.find(isGoalNode) ?? null,
    [storeNodes],
  );

  // Edge color helper
  function edgeColor(type: string): string {
    if (type === "blocks" || type === "blocker") return "#B81917";
    if (type === "depends_on") return "#f59e0b";
    if (type === "sequence") return "#3B82F6";
    return "#999";
  }

  // Status dot
  function statusDot(cx: number, cy: number, r: number, status: string) {
    if (status === "not_started") return null;
    return (
      <circle
        cx={cx + r * 0.7}
        cy={cy - r * 0.7}
        r={3}
        fill={statusColor(status)}
        stroke="#FFF"
        strokeWidth={1}
        pointerEvents="none"
      />
    );
  }

  // -- Empty / Loading states --
  if (storeNodes.length === 0) {
    return (
      <div
        className="canvas-area"
        style={{
          background: "#FEFEFE",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span style={{ color: "#999", fontSize: 12, fontFamily: "Tomorrow, sans-serif" }}>
          No nodes yet. Create your first node with +NODE.
        </span>
      </div>
    );
  }

  return (
    <div className="canvas-area" style={{ background: "#FEFEFE", position: "relative" }}>
      {/* Physics/Static toggle + Fit button */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          display: "flex",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            background: "#fff",
            border: "1px solid #E0E0E0",
            borderRadius: 6,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          {(["physics", "static"] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "6px 14px",
                fontSize: 10,
                letterSpacing: 0.5,
                cursor: "pointer",
                border: "none",
                background: mode === m ? "#1A1A1A" : "transparent",
                color: mode === m ? "#fff" : "#888",
                fontWeight: 500,
                fontFamily: "Tomorrow, sans-serif",
                textTransform: "uppercase",
              }}
            >
              {m}
            </button>
          ))}
        </div>
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

      <svg
        ref={svgRef}
        onMouseDown={onBgMouseDown}
        style={{ userSelect: "none", cursor: "grab", width: "100%", height: "100%" }}
      >
        {/* Dot grid pattern */}
        <defs>
          <pattern
            id="graph-dots"
            x="0"
            y="0"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="20" cy="20" r="0.5" fill="#E8E8E8" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#graph-dots)" pointerEvents="none" />

        <g
          style={{
            transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.z})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Goal → cluster parent connector lines */}
          {(() => {
            if (!goalNode) return null;
            const goalPos = posMap.get(goalNode.id);
            if (!goalPos) return null;
            const clusters = storeNodes.filter((n) =>
              isClusterNode(n.id, childrenMap),
            );
            return clusters.map((cluster) => {
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
                  x2={cPos.x - (dx / dist) * 10}
                  y2={cPos.y - (dy / dist) * 10}
                  stroke="#D0D0D0"
                  strokeWidth={0.8}
                  style={{
                    opacity: dim ? 0.08 : 0.4,
                    transition: "opacity 0.2s",
                  }}
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
            const isConnected =
              selId && (fromId === selId || toId === selId);
            const dim = selId && !isConnected;
            const color = edgeColor(type);
            return (
              <g
                key={edgeId}
                style={{
                  opacity: dim ? 0.08 : 0.6,
                  transition: "opacity 0.2s",
                }}
              >
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={color}
                  strokeWidth={dim ? 0.8 : 1.5}
                  strokeDasharray={type === "depends_on" ? "4,3" : undefined}
                />
                <polygon
                  points={`${x2},${y2} ${x2 - nx * 6 + ny * 3},${y2 - ny * 6 - nx * 3} ${x2 - nx * 6 - ny * 3},${y2 - ny * 6 + nx * 3}`}
                  fill={color}
                />
              </g>
            );
          })}

          {/* Cluster parent nodes — circles */}
          {storeNodes
            .filter((n) => isClusterNode(n.id, childrenMap) && !isGoalNode(n))
            .map((cluster) => {
              const pos = posMap.get(cluster.id);
              if (!pos) return null;
              const isSel = selId === cluster.id;
              const dim =
                selId && !isSel && !connectedIds.has(cluster.id);
              const isHovered = hoveredNode === cluster.id;
              return (
                <g
                  key={`cl-${cluster.id}`}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, cluster.id)}
                  onMouseEnter={() => setHoveredNode(cluster.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    opacity: dim ? 0.15 : 1,
                    transition: "opacity 0.2s",
                    cursor: "pointer",
                  }}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={isSel ? 12 : 10}
                    fill={priorityColor(cluster.priority)}
                    stroke={isSel ? "#1A1A1A" : "#FFF"}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  {statusDot(pos.x, pos.y, 10, cluster.status)}
                  <text
                    x={pos.x}
                    y={pos.y + (isHovered ? 16 : 14)}
                    textAnchor="middle"
                    fontSize={isHovered ? 11 : 7}
                    fontWeight={isSel || isHovered ? "600" : "500"}
                    fill={isSel ? "#1A1A1A" : "#777"}
                    pointerEvents="none"
                    style={{ transition: "font-size 0.15s" }}
                  >
                    {cluster.name.length > 24
                      ? cluster.name.slice(0, 22) + "…"
                      : cluster.name}
                  </text>
                </g>
              );
            })}

          {/* Goal node */}
          {(() => {
            const gn = goalNode;
            if (!gn) return null;
            const pos = posMap.get(gn.id);
            if (!pos) return null;
            const r = 22;
            const isSelected = selId === gn.id;
            const dimmed =
              selId && !isSelected && !connectedIds.has(gn.id);
            return (
              <g
                className="graph-node"
                onMouseDown={(e) => onNodeMouseDown(e, gn.id)}
                style={{
                  opacity: dimmed ? 0.15 : 1,
                  transition: "opacity 0.2s",
                  cursor: "pointer",
                }}
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r}
                  fill="#1A1A1A"
                  stroke={isSelected ? "#B81917" : "none"}
                  strokeWidth={isSelected ? 2 : 0}
                />
                <text
                  x={pos.x}
                  y={pos.y + 1}
                  textAnchor="middle"
                  fontSize="7"
                  fontWeight="600"
                  fill="#FFFFFF"
                  pointerEvents="none"
                >
                  {gn.name.length > 18
                    ? gn.name.slice(0, 16) + "…"
                    : gn.name}
                </text>
                <text
                  x={pos.x}
                  y={pos.y + r + 12}
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

          {/* Regular task nodes */}
          {storeNodes
            .filter(
              (n) =>
                !isClusterNode(n.id, childrenMap) && !isGoalNode(n),
            )
            .map((node) => {
              const pos = posMap.get(node.id);
              if (!pos) return null;
              const r = 6;
              const isSelected = selId === node.id;
              const dimmed =
                selId && !isSelected && !connectedIds.has(node.id);
              const fill =
                node.status === "done"
                  ? "#16a34a"
                  : priorityColor(node.priority);
              const isHovered = hoveredNode === node.id;
              return (
                <g
                  key={node.id}
                  className="graph-node"
                  onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    opacity: dimmed ? 0.15 : 1,
                    transition: "opacity 0.2s",
                    cursor: "pointer",
                  }}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={isSelected ? r + 1.5 : r}
                    fill={fill}
                    stroke={isSelected ? "#1A1A1A" : "#FFF"}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  {statusDot(pos.x, pos.y, r, node.status)}
                  <text
                    x={pos.x}
                    y={pos.y + r + 10}
                    textAnchor="middle"
                    fontSize={isHovered ? 11 : 7}
                    fontWeight={isSelected || isHovered ? "600" : "400"}
                    fill={isSelected ? "#1A1A1A" : "#777"}
                    pointerEvents="none"
                    style={{ transition: "font-size 0.15s" }}
                  >
                    {node.name.length > 24
                      ? node.name.slice(0, 22) + "…"
                      : node.name}
                  </text>
                </g>
              );
            })}
        </g>
      </svg>
    </div>
  );
}
