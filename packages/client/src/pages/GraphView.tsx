import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  PRIORITIES,
  EDGE_TYPES,
  buildClusterMaps,
  isClusterNode,
  priorityColor,
  statusColor,
  statusLabel,
  STATUSES,
} from "../constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface GraphViewProps {
  onNavigateToNode?: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Workstream colors (stable per workstream name)
// ---------------------------------------------------------------------------
const WS_PALETTE = [
  "#B81917",
  "#3B82F6",
  "#16a34a",
  "#f59e0b",
  "#8B5CF6",
  "#06B6D4",
  "#EC4899",
  "#F97316",
];

function workstreamColor(ws: string, allWorkstreams: string[]): string {
  const idx = allWorkstreams.indexOf(ws);
  return WS_PALETTE[idx >= 0 ? idx % WS_PALETTE.length : 0];
}

// ---------------------------------------------------------------------------
// Layout — arrange nodes that lack x/y positions
// ---------------------------------------------------------------------------
function computeLayout(
  nodes: Node[],
  edges: Edge[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Group by workstream
  const workstreams = new Map<string, Node[]>();
  for (const n of nodes) {
    const ws = n.workstream ?? "Other";
    const group = workstreams.get(ws) ?? [];
    group.push(n);
    workstreams.set(ws, group);
  }

  const COL_WIDTH = 180;
  const ROW_HEIGHT = 80;
  const WS_GAP = 200;
  let wsAngle = 0;
  const wsCount = workstreams.size;

  for (const [, wsNodes] of workstreams) {
    // Place workstream around the center in a radial pattern
    const angleRad = (wsAngle / wsCount) * 2 * Math.PI - Math.PI / 2;
    const wsRadius = 350;
    const wsCenter = {
      x: Math.cos(angleRad) * wsRadius,
      y: Math.sin(angleRad) * wsRadius,
    };

    // Separate cluster parents from leaf nodes
    const clusterParents = wsNodes.filter((n) =>
      isClusterNode(n.id, childrenMap),
    );
    const leafNodes = wsNodes.filter(
      (n) => !isClusterNode(n.id, childrenMap) && !parentMap.has(n.id),
    );

    let yOff = 0;

    // Place cluster parents and their children
    for (const cp of clusterParents) {
      const children = (childrenMap.get(cp.id) ?? [])
        .map((cid) => nodes.find((n) => n.id === cid))
        .filter(Boolean) as Node[];

      // Parent position
      positions.set(cp.id, {
        x: wsCenter.x,
        y: wsCenter.y + yOff,
      });

      // Children in a row below the parent
      for (let i = 0; i < children.length; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        positions.set(children[i].id, {
          x: wsCenter.x + (col - 1) * COL_WIDTH,
          y: wsCenter.y + yOff + ROW_HEIGHT + row * ROW_HEIGHT,
        });
      }

      yOff += ROW_HEIGHT + Math.ceil(children.length / 3) * ROW_HEIGHT + 60;
    }

    // Place remaining leaf nodes
    for (let i = 0; i < leafNodes.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      positions.set(leafNodes[i].id, {
        x: wsCenter.x + (col - 1) * COL_WIDTH,
        y: wsCenter.y + yOff + row * ROW_HEIGHT,
      });
    }

    wsAngle++;
  }

  return positions;
}

// ---------------------------------------------------------------------------
// SVG coordinate helpers
// ---------------------------------------------------------------------------
function screenToSvg(
  clientX: number,
  clientY: number,
  svgRect: DOMRect,
  vp: Viewport,
): { x: number; y: number } {
  return {
    x: (clientX - svgRect.left - vp.x) / vp.zoom,
    y: (clientY - svgRect.top - vp.y) / vp.zoom,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function GraphView({ onNavigateToNode }: GraphViewProps) {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const filters = useGraphStore((s) => s.filters);
  const collapsed = useGraphStore((s) => s.collapsed);
  const toggleCollapsed = useGraphStore((s) => s.toggleCollapsed);
  const collapseAll = useGraphStore((s) => s.collapseAll);

  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [hasFitView, setHasFitView] = useState(false);
  const hasInitCollapsed = useRef(false);

  // Derived cluster maps
  const { parentMap, childrenMap } = useMemo(
    () => buildClusterMaps(storeEdges),
    [storeEdges],
  );

  // Collapse all clusters by default on initial load
  useEffect(() => {
    if (hasInitCollapsed.current || childrenMap.size === 0) return;
    hasInitCollapsed.current = true;
    collapseAll([...childrenMap.keys()]);
  }, [childrenMap, collapseAll]);

  // All unique workstreams
  const allWorkstreams = useMemo(
    () => [
      ...new Set(
        storeNodes.map((n) => n.workstream).filter(Boolean) as string[],
      ),
    ],
    [storeNodes],
  );

  // Layout positions for nodes without x/y
  const layoutPositions = useMemo(
    () => computeLayout(storeNodes, storeEdges, childrenMap, parentMap),
    [storeNodes, storeEdges, childrenMap, parentMap],
  );

  // Effective positions (pinned or layout)
  const nodePos = useCallback(
    (n: Node): { x: number; y: number } => {
      if (n.x != null && n.y != null) return { x: n.x, y: n.y };
      return layoutPositions.get(n.id) ?? { x: 0, y: 0 };
    },
    [layoutPositions],
  );

  // Build a map of nodeId → effective position for quick lookup
  const posMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of storeNodes) m.set(n.id, nodePos(n));
    return m;
  }, [storeNodes, nodePos]);

  // Visibility: which nodes are hidden because their cluster parent is collapsed
  const hiddenNodes = useMemo(() => {
    const hidden = new Set<string>();
    for (const cid of collapsed) {
      for (const childId of childrenMap.get(cid) ?? []) {
        hidden.add(childId);
      }
    }
    return hidden;
  }, [collapsed, childrenMap]);

  const visibleNodes = useMemo(
    () => storeNodes.filter((n) => !hiddenNodes.has(n.id)),
    [storeNodes, hiddenNodes],
  );

  // Selection dimming
  const selId = selectedNode?.id ?? null;
  const connectedIds = useMemo(() => {
    if (!selId) return new Set<string>();
    const ids = new Set<string>();
    ids.add(selId);
    for (const e of storeEdges) {
      if (e.sourceId === selId) ids.add(e.targetId);
      if (e.targetId === selId) ids.add(e.sourceId);
    }
    // Siblings (same parent)
    const parentId = parentMap.get(selId);
    if (parentId) {
      ids.add(parentId);
      for (const sib of childrenMap.get(parentId) ?? []) ids.add(sib);
    }
    // Children (if cluster selected)
    for (const child of childrenMap.get(selId) ?? []) ids.add(child);
    return ids;
  }, [selId, storeEdges, parentMap, childrenMap]);

  // Filter matching
  const hasActiveFilter = !!(filters.status || filters.workstream);
  const matchesFilter = useCallback(
    (n: Node) => {
      if (filters.status && n.status !== filters.status) return false;
      if (filters.workstream && n.workstream !== filters.workstream)
        return false;
      return true;
    },
    [filters],
  );

  // Compute node opacity
  const nodeOpacity = useCallback(
    (n: Node): number => {
      if (hasActiveFilter && !matchesFilter(n)) return 0.12;
      if (selId && !connectedIds.has(n.id)) return 0.25;
      return 1;
    },
    [selId, connectedIds, hasActiveFilter, matchesFilter],
  );

  // Edge opacity
  const edgeOpacity = useCallback(
    (e: Edge): number => {
      if (selId && e.sourceId !== selId && e.targetId !== selId) return 0.12;
      return 1;
    },
    [selId],
  );

  // ---------- Edges: reroute collapsed children to cluster parent ----------
  const visibleEdges = useMemo(() => {
    const result: Array<{
      edge: Edge;
      fromPos: { x: number; y: number };
      toPos: { x: number; y: number };
    }> = [];
    const seen = new Set<string>();

    for (const e of storeEdges) {
      if (e.type === "parent_of") continue; // Don't draw parent_of edges as lines

      let sourceId = e.sourceId;
      let targetId = e.targetId;

      // Reroute hidden source/target to their cluster parent
      if (hiddenNodes.has(sourceId)) {
        sourceId = parentMap.get(sourceId) ?? sourceId;
      }
      if (hiddenNodes.has(targetId)) {
        targetId = parentMap.get(targetId) ?? targetId;
      }

      // Skip if both endpoints are the same after rerouting
      if (sourceId === targetId) continue;

      // Deduplicate
      const key = `${sourceId}->${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fromPos = posMap.get(sourceId);
      const toPos = posMap.get(targetId);
      if (!fromPos || !toPos) continue;

      result.push({ edge: e, fromPos, toPos });
    }
    return result;
  }, [storeEdges, hiddenNodes, parentMap, posMap]);

  // ---------- Workstream overlays ----------
  const wsOverlays = useMemo(() => {
    const overlays: Array<{
      ws: string;
      color: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }> = [];
    for (const ws of allWorkstreams) {
      const wsNodePositions = visibleNodes
        .filter((n) => n.workstream === ws)
        .map((n) => posMap.get(n.id))
        .filter(Boolean) as Array<{ x: number; y: number }>;
      if (wsNodePositions.length < 2) continue;
      const pad = 60;
      const minX = Math.min(...wsNodePositions.map((p) => p.x)) - pad;
      const minY = Math.min(...wsNodePositions.map((p) => p.y)) - pad - 20;
      const maxX = Math.max(...wsNodePositions.map((p) => p.x)) + pad;
      const maxY = Math.max(...wsNodePositions.map((p) => p.y)) + pad + 14;
      overlays.push({
        ws,
        color: workstreamColor(ws, allWorkstreams),
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      });
    }
    return overlays;
  }, [allWorkstreams, visibleNodes, posMap]);

  // ---------- Fit view on mount ----------
  useEffect(() => {
    if (hasFitView || storeNodes.length === 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    fitViewToNodes(svg);
    setHasFitView(true);
  }, [storeNodes.length, hasFitView]);

  function fitViewToNodes(svg: SVGSVGElement) {
    const positions = storeNodes.map(
      (n) => posMap.get(n.id) ?? { x: 0, y: 0 },
    );
    if (positions.length === 0) return;
    const pad = 100;
    const minX = Math.min(...positions.map((p) => p.x)) - pad;
    const minY = Math.min(...positions.map((p) => p.y)) - pad;
    const maxX = Math.max(...positions.map((p) => p.x)) + pad;
    const maxY = Math.max(...positions.map((p) => p.y)) + pad;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const rect = svg.getBoundingClientRect();
    const sw = rect.width;
    const sh = rect.height;
    const zoom = Math.min(sw / bw, sh / bh, 2);
    setVp({
      x: sw / 2 - ((minX + maxX) / 2) * zoom,
      y: sh / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  }

  // ---------- Pan ----------
  const onBgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Only pan if clicking on SVG background (not a node/cluster)
      const tag = (e.target as Element).tagName.toLowerCase();
      if (tag === "svg" || tag === "rect") {
        setIsPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, vpX: vp.x, vpY: vp.y };
        selectNode(null);
      }
    },
    [vp, selectNode],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setVp((v) => ({
          ...v,
          x: panStart.current.vpX + dx,
          y: panStart.current.vpY + dy,
        }));
        return;
      }

      if (dragNodeId) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const pos = screenToSvg(e.clientX, e.clientY, rect, vp);
        const nx = pos.x - dragOffset.current.x;
        const ny = pos.y - dragOffset.current.y;

        // If dragging a cluster parent, move all children by the same delta
        if (isClusterNode(dragNodeId, childrenMap)) {
          const oldPos = posMap.get(dragNodeId);
          if (oldPos) {
            const ddx = nx - oldPos.x;
            const ddy = ny - oldPos.y;
            for (const childId of childrenMap.get(dragNodeId) ?? []) {
              const cp = posMap.get(childId);
              if (cp) {
                updateNode(childId, {
                  x: cp.x + ddx,
                  y: cp.y + ddy,
                } as Partial<Node>);
              }
            }
          }
        }

        updateNode(dragNodeId, { x: nx, y: ny } as Partial<Node>);
      }
    },
    [isPanning, dragNodeId, vp, childrenMap, posMap, updateNode],
  );

  const onMouseUp = useCallback(() => {
    if (dragNodeId) {
      const pos = posMap.get(dragNodeId);
      if (pos) {
        // Persist position to API
        api(`/nodes/${dragNodeId}`, {
          method: "PATCH",
          body: JSON.stringify({
            x: pos.x,
            y: pos.y,
            position_pinned: true,
          }),
        }).catch(console.error);

        // Also persist children if cluster
        if (isClusterNode(dragNodeId, childrenMap)) {
          for (const childId of childrenMap.get(dragNodeId) ?? []) {
            const cp = posMap.get(childId);
            if (cp) {
              api(`/nodes/${childId}`, {
                method: "PATCH",
                body: JSON.stringify({
                  x: cp.x,
                  y: cp.y,
                  position_pinned: true,
                }),
              }).catch(console.error);
            }
          }
        }
      }
      setDragNodeId(null);
    }
    setIsPanning(false);
  }, [dragNodeId, posMap, childrenMap]);

  // ---------- Zoom ----------
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setVp((v) => {
        const newZoom = Math.min(4, Math.max(0.15, v.zoom * factor));
        const scale = newZoom / v.zoom;
        return {
          x: mx - (mx - v.x) * scale,
          y: my - (my - v.y) * scale,
          zoom: newZoom,
        };
      });
    },
    [],
  );

  // ---------- Node mouse down (for dragging) ----------
  const onNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const pos = screenToSvg(e.clientX, e.clientY, rect, vp);
      const nodeP = posMap.get(nodeId) ?? { x: 0, y: 0 };
      dragOffset.current = { x: pos.x - nodeP.x, y: pos.y - nodeP.y };
      setDragNodeId(nodeId);

      const node = storeNodes.find((n) => n.id === nodeId) ?? null;
      selectNode(node);
    },
    [vp, posMap, storeNodes, selectNode],
  );

  // ---------- Zoom controls ----------
  const zoomIn = () =>
    setVp((v) => ({ ...v, zoom: Math.min(4, v.zoom * 1.2) }));
  const zoomOut = () =>
    setVp((v) => ({ ...v, zoom: Math.max(0.15, v.zoom / 1.2) }));
  const fitView = () => {
    const svg = svgRef.current;
    if (svg) fitViewToNodes(svg);
  };

  // ---------- Render ----------
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        fontFamily: "Tomorrow, sans-serif",
      }}
    >
      {/* Filter bar */}
      <FilterBar />

      {/* SVG canvas */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{
            userSelect: "none",
            cursor: isPanning
              ? "grabbing"
              : dragNodeId
                ? "grabbing"
                : "grab",
            background: "#FFFFFF",
          }}
          onMouseDown={onBgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          {/* Defs: arrow markers */}
          <defs>
            {Object.entries(EDGE_TYPES).map(([type, cfg]) => (
              <marker
                key={type}
                id={`arrow-${type}`}
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <polygon points="0,0 10,5 0,10" fill={cfg.color} />
              </marker>
            ))}
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <polygon points="0,0 10,5 0,10" fill="#999" />
            </marker>
          </defs>

          {/* Background — pointer-events:none so clicks fall through to nodes.
              Pan is handled by onMouseDown on the SVG element itself. */}
          <rect
            className="graph-bg"
            width="100%"
            height="100%"
            fill="white"
            style={{ pointerEvents: "none" }}
          />

          <g
            transform={`translate(${vp.x},${vp.y}) scale(${vp.zoom})`}
            style={{ transformOrigin: "0 0" }}
          >
            {/* Concentric rings */}
            {[200, 400, 600].map((r) => (
              <circle
                key={r}
                cx={0}
                cy={0}
                r={r}
                fill="none"
                stroke="rgba(0,0,0,0.06)"
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            ))}

            {/* Workstream overlays */}
            {wsOverlays.map((ov) => (
              <g key={ov.ws}>
                <rect
                  x={ov.x}
                  y={ov.y}
                  width={ov.w}
                  height={ov.h}
                  rx={12}
                  fill={`${ov.color}10`}
                  stroke={ov.color}
                  strokeWidth={1}
                  strokeDasharray="8 4"
                  opacity={0.6}
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={ov.x + 10}
                  y={ov.y + 16}
                  fill={ov.color}
                  fontSize={10}
                  fontFamily="Tomorrow, sans-serif"
                  style={{
                    letterSpacing: "2px",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  {ov.ws}
                </text>
              </g>
            ))}

            {/* Cluster containers */}
            {visibleNodes
              .filter((n) => isClusterNode(n.id, childrenMap))
              .map((cluster) => {
                const pos = posMap.get(cluster.id) ?? { x: 0, y: 0 };
                const color = priorityColor(cluster.priority);
                const isSel = selId === cluster.id;
                const isCol = collapsed.has(cluster.id);
                const childIds = childrenMap.get(cluster.id) ?? [];

                // Dimming for cluster
                const clDim =
                  selId &&
                  !isSel &&
                  !childIds.some((cid) => cid === selId);

                if (isCol) {
                  // Collapsed: small rectangle
                  const w = 150;
                  const h = 22;
                  return (
                    <g
                      key={"cl-" + cluster.id}
                      style={{
                        opacity: clDim ? 0.25 : 1,
                        transition: "opacity 0.2s",
                      }}
                    >
                      <rect
                        x={pos.x - w / 2}
                        y={pos.y - h / 2}
                        width={w}
                        height={h}
                        rx={4}
                        fill="#FFF"
                        stroke={color}
                        strokeWidth={isSel ? 2 : 1}
                        style={{ cursor: "grab" }}
                        onMouseDown={(e) => onNodeMouseDown(e, cluster.id)}
                      />
                      <text
                        x={pos.x - w / 2 + 8}
                        y={pos.y + 3}
                        fontSize={7}
                        fontWeight={600}
                        letterSpacing={1}
                        fill={color}
                        style={{ pointerEvents: "none" }}
                      >
                        {cluster.name.toUpperCase()}
                      </text>
                      <text
                        x={pos.x + w / 2 - 30}
                        y={pos.y + 3}
                        fontSize={7}
                        fill="#999"
                        style={{ pointerEvents: "none" }}
                      >
                        {childIds.length}
                      </text>
                      <text
                        x={pos.x + w / 2 - 14}
                        y={pos.y + 4}
                        fontSize={10}
                        fill={color}
                        style={{ cursor: "pointer" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          toggleCollapsed(cluster.id);
                        }}
                      >
                        {"\u25B6"}
                      </text>
                    </g>
                  );
                }

                // Expanded: bounding box around children
                const childPositions = childIds
                  .map((cid) => posMap.get(cid))
                  .filter(Boolean) as Array<{ x: number; y: number }>;
                if (childPositions.length === 0) return null;

                const pad = 28;
                const hH = 22;
                const allX = [pos.x, ...childPositions.map((p) => p.x)];
                const allY = [pos.y, ...childPositions.map((p) => p.y)];
                const minX = Math.min(...allX) - pad;
                const maxX = Math.max(...allX) + pad;
                const minY = Math.min(...allY) - pad;
                const maxY = Math.max(...allY) + pad + 14;
                const rW = Math.max(150, maxX - minX);
                const rH = maxY - minY + hH;
                const rX = minX;
                const rY = minY - hH;

                return (
                  <g
                    key={"cl-" + cluster.id}
                    style={{
                      opacity: clDim ? 0.25 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {/* Body */}
                    <rect
                      x={rX}
                      y={rY}
                      width={rW}
                      height={rH}
                      rx={8}
                      fill={color}
                      fillOpacity={0.03}
                      stroke={color}
                      strokeOpacity={isSel ? 0.4 : 0.12}
                      strokeWidth={isSel ? 2 : 1}
                      style={{ pointerEvents: "none" }}
                    />
                    {/* Header bar */}
                    <rect
                      x={rX}
                      y={rY}
                      width={rW}
                      height={hH}
                      rx={8}
                      fill={color}
                      fillOpacity={0.07}
                      style={{ cursor: "grab" }}
                      onMouseDown={(e) => onNodeMouseDown(e, cluster.id)}
                    />
                    {/* Fill gap between header rounded corners and body */}
                    <rect
                      x={rX}
                      y={rY + hH - 8}
                      width={rW}
                      height={8}
                      fill={color}
                      fillOpacity={0.07}
                      style={{ pointerEvents: "none" }}
                    />
                    {/* Cluster label */}
                    <text
                      x={rX + 10}
                      y={rY + 15}
                      fontSize={7}
                      fontWeight={600}
                      letterSpacing={1.5}
                      fill={color}
                      style={{ pointerEvents: "none" }}
                    >
                      {cluster.name.toUpperCase()}
                    </text>
                    {/* Collapse toggle */}
                    <text
                      x={rX + rW - 14}
                      y={rY + 15}
                      fontSize={10}
                      fill={color}
                      style={{ cursor: "pointer" }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        toggleCollapsed(cluster.id);
                      }}
                    >
                      {"\u25BC"}
                    </text>
                  </g>
                );
              })}

            {/* Edges */}
            {visibleEdges.map(({ edge, fromPos, toPos }, i) => {
              const dx = toPos.x - fromPos.x;
              const dy = toPos.y - fromPos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 1) return null;
              const nr = 10;
              const ux = dx / dist;
              const uy = dy / dist;
              const fx = fromPos.x + ux * nr;
              const fy = fromPos.y + uy * nr;
              const tx = toPos.x - ux * nr;
              const ty = toPos.y - uy * nr;

              const edgeCfg = EDGE_TYPES[edge.type];
              const color = edgeCfg?.color ?? "#999";
              const dash = edgeCfg?.dash;
              const markerId = edgeCfg
                ? `arrow-${edge.type}`
                : "arrow-default";

              return (
                <g
                  key={`edge-${i}`}
                  style={{
                    opacity: edgeOpacity(edge),
                    transition: "opacity 0.2s",
                  }}
                >
                  <line
                    x1={fx}
                    y1={fy}
                    x2={tx}
                    y2={ty}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray={dash}
                    markerEnd={`url(#${markerId})`}
                  />
                </g>
              );
            })}

            {/* Nodes (non-cluster leaf nodes) */}
            {visibleNodes
              .filter((n) => !isClusterNode(n.id, childrenMap))
              .map((node) => {
                const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
                const r = 7;
                const isSel = selId === node.id;
                const fill = priorityColor(node.priority);
                const isDone = node.status === "done";

                return (
                  <g
                    key={node.id}
                    style={{
                      opacity: nodeOpacity(node),
                      transition: "opacity 0.2s",
                      cursor: dragNodeId === node.id ? "grabbing" : "grab",
                    }}
                    onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                  >
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={isSel ? r + 2 : r}
                      fill={fill}
                      stroke={isSel ? "#1A1A1A" : "none"}
                      strokeWidth={isSel ? 2.5 : 0}
                    />
                    {isDone && (
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={r + 3}
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth={1.5}
                        strokeDasharray="3,2"
                        opacity={0.5}
                      />
                    )}
                    <text
                      x={pos.x}
                      y={pos.y + r + 12}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={isSel ? 700 : 400}
                      fill={isSel ? "#1A1A1A" : "#414042"}
                      fontFamily="Tomorrow, sans-serif"
                      style={{ pointerEvents: "none" }}
                    >
                      {node.name.length > 20
                        ? node.name.slice(0, 20) + "\u2026"
                        : node.name}
                    </text>
                  </g>
                );
              })}
          </g>
        </svg>

        {/* Zoom controls */}
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <ZoomButton label="+" onClick={zoomIn} />
          <ZoomButton label="\u2013" onClick={zoomOut} />
          <ZoomButton label="\u2316" onClick={fitView} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------
function FilterBar() {
  const nodes = useGraphStore((s) => s.nodes);
  const filters = useGraphStore((s) => s.filters);
  const setFilter = useGraphStore((s) => s.setFilter);
  const workstreams = useMemo(
    () =>
      [
        ...new Set(
          nodes.map((n) => n.workstream).filter(Boolean) as string[],
        ),
      ],
    [nodes],
  );

  const sel: React.CSSProperties = {
    padding: "4px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontFamily: "Tomorrow, sans-serif",
    fontSize: 13,
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid #e5e5e5",
        fontSize: 13,
        fontFamily: "Tomorrow, sans-serif",
      }}
    >
      <select
        value={filters.status ?? ""}
        onChange={(e) => setFilter("status", e.target.value || null)}
        style={sel}
      >
        <option value="">All statuses</option>
        {Object.entries(STATUSES).map(([key, s]) => (
          <option key={key} value={key}>
            {s.label}
          </option>
        ))}
      </select>
      {workstreams.length > 0 && (
        <select
          value={filters.workstream ?? ""}
          onChange={(e) => setFilter("workstream", e.target.value || null)}
          style={sel}
        >
          <option value="">All workstreams</option>
          {workstreams.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZoomButton
// ---------------------------------------------------------------------------
function ZoomButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        border: "1px solid #ddd",
        borderRadius: 4,
        background: "#fff",
        cursor: "pointer",
        fontFamily: "Tomorrow, sans-serif",
        fontSize: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#414042",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
      }}
    >
      {label}
    </button>
  );
}
